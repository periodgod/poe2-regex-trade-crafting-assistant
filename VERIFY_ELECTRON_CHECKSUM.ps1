param(
  [Parameter(Mandatory=$true)][string]$ZipPath,
  [Parameter(Mandatory=$true)][string]$FileName,
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][string]$CacheDir
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Find-ExpectedHash {
  param(
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [Parameter(Mandatory=$true)][string]$WantedFile
  )
  $wantedLeaf = [System.IO.Path]::GetFileName($WantedFile)
  foreach ($rawLine in (Get-Content -LiteralPath $ManifestPath -ErrorAction Stop)) {
    $line = [string]$rawLine
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -match '^\s*([0-9A-Fa-f]{64})\s+\*?(.+?)\s*$') {
      if ([System.IO.Path]::GetFileName($Matches[2].Trim()) -ieq $wantedLeaf) {
        return $Matches[1].ToLowerInvariant()
      }
    }
    if ($line -match '^\s*(.+?)\s+([0-9A-Fa-f]{64})\s*$') {
      if ([System.IO.Path]::GetFileName($Matches[1].Trim()) -ieq $wantedLeaf) {
        return $Matches[2].ToLowerInvariant()
      }
    }
  }
  return $null
}

function Test-ZipEntrySafety {
  param([Parameter(Mandatory=$true)][string]$ArchivePath)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    if ($archive.Entries.Count -lt 10) { throw "Electron archive contains too few entries." }
    foreach ($entry in $archive.Entries) {
      $name = [string]$entry.FullName
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      $normal = $name.Replace('\\','/')
      if ($normal.StartsWith('/') -or $normal -match '^[A-Za-z]:' -or $normal.Split('/') -contains '..') {
        throw "Unsafe ZIP entry was rejected: $name"
      }
    }
  }
  finally { $archive.Dispose() }
}

function Test-AuthenticodeElectron {
  param(
    [Parameter(Mandatory=$true)][string]$ArchivePath,
    [Parameter(Mandatory=$true)][string]$ExpectedVersion,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory
  )
  Test-ZipEntrySafety -ArchivePath $ArchivePath
  $probe = Join-Path $WorkingDirectory "signature-probe"
  Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $probe -Force | Out-Null
  try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $probe)
    $exe = Join-Path $probe "electron.exe"
    $resources = Join-Path $probe "resources"
    $locales = Join-Path $probe "locales"
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "electron.exe is missing from the archive." }
    if (-not (Test-Path -LiteralPath $resources -PathType Container)) { throw "resources directory is missing from the archive." }
    if (-not (Test-Path -LiteralPath $locales -PathType Container)) { throw "locales directory is missing from the archive." }

    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
      throw "electron.exe Authenticode status is $($signature.Status): $($signature.StatusMessage)"
    }
    $subject = [string]$signature.SignerCertificate.Subject
    if ([string]::IsNullOrWhiteSpace($subject)) { throw "electron.exe signer certificate is missing." }

    $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    $productVersion = [string]$info.ProductVersion
    if ([string]::IsNullOrWhiteSpace($productVersion)) { throw "electron.exe ProductVersion is missing." }
    $normalizedProductVersion = ($productVersion -replace '[^0-9.].*$','').TrimEnd('.')
    if (-not ($normalizedProductVersion -eq $ExpectedVersion -or $normalizedProductVersion.StartsWith("$ExpectedVersion."))) {
      throw "electron.exe ProductVersion $productVersion does not match requested Electron $ExpectedVersion."
    }
    $productName = [string]$info.ProductName
    $description = [string]$info.FileDescription
    if (($productName -notmatch '(?i)electron') -and ($description -notmatch '(?i)electron')) {
      throw "The signed executable does not identify itself as Electron (ProductName='$productName', FileDescription='$description')."
    }

    Write-Host "Authenticode signer: $subject"
    Write-Host "Electron ProductVersion: $productVersion"
    return $true
  }
  finally { Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction SilentlyContinue }
}

if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
  throw "Electron ZIP does not exist: $ZipPath"
}
if ((Get-Item -LiteralPath $ZipPath).Length -lt 1048576) {
  throw "Electron ZIP is unexpectedly small."
}

New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
$manifestPath = Join-Path $CacheDir "SHASUMS256.txt"
$versionTag = "v$Version"
$sources = @(
  "https://npmmirror.com/mirrors/electron/$versionTag/SHASUMS256.txt",
  "https://github.com/electron/electron/releases/download/$versionTag/SHASUMS256.txt"
)

$expected = $null
$usedSource = $null
$errors = New-Object System.Collections.Generic.List[string]
foreach ($source in $sources) {
  try {
    Write-Host "Trying checksum source: $source"
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    & curl.exe -L --fail --retry 2 --retry-delay 1 --connect-timeout 15 --max-time 90 --silent --show-error -o $manifestPath $source
    if ($LASTEXITCODE -ne 0) { throw "curl exit code $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "manifest file was not created" }
    if ((Get-Item -LiteralPath $manifestPath).Length -lt 64) { throw "manifest is unexpectedly small" }
    $expected = Find-ExpectedHash -ManifestPath $manifestPath -WantedFile $FileName
    if ($expected) { $usedSource = $source; break }
    $preview = (Get-Content -LiteralPath $manifestPath -TotalCount 2 -ErrorAction SilentlyContinue) -join " | "
    throw "file entry not found; manifest preview: $preview"
  }
  catch { $errors.Add("$source -> $($_.Exception.Message)") }
}

if (-not $expected) {
  # GitHub release API exposes an official sha256 digest for release assets.
  # This path avoids the large release-asset redirect used by SHASUMS256.txt and
  # also avoids trusting a mirror manifest that accidentally contains Node files.
  $releaseMetadataPath = Join-Path $CacheDir "electron-release-$Version.json"
  $releaseApi = "https://api.github.com/repos/electron/electron/releases/tags/$versionTag"
  try {
    Remove-Item -LiteralPath $releaseMetadataPath -Force -ErrorAction SilentlyContinue
    & curl.exe -L --fail --retry 2 --retry-delay 1 --connect-timeout 15 --max-time 90 --silent --show-error `
      -H "Accept: application/vnd.github+json" `
      -H "User-Agent: poe2-regex-trade-crafting-assistant/1.7.0" `
      -o $releaseMetadataPath $releaseApi
    if ($LASTEXITCODE -ne 0) { throw "curl exit code $LASTEXITCODE" }
    $release = Get-Content -LiteralPath $releaseMetadataPath -Raw -ErrorAction Stop | ConvertFrom-Json
    $asset = @($release.assets) | Where-Object { [string]$_.name -ieq $FileName } | Select-Object -First 1
    $digest = [string]$asset.digest
    if ($digest -match '^sha256:([0-9A-Fa-f]{64})$') {
      $expected = $Matches[1].ToLowerInvariant()
      $usedSource = "$releaseApi (asset digest)"
    }
    else { throw "release asset digest was missing for $FileName" }
  }
  catch { $errors.Add("$releaseApi -> $($_.Exception.Message)") }
  finally { Remove-Item -LiteralPath $releaseMetadataPath -Force -ErrorAction SilentlyContinue }
}

$actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected) {
  Write-Host ""
  Write-Host "Checksum source: $usedSource"
  Write-Host "Expected: $expected"
  Write-Host "Actual:   $actual"
  if ($expected -ne $actual) { throw "SHA-256 checksum mismatch. The ZIP will not be installed." }
  Write-Host "SHA-256 verification passed." -ForegroundColor Green
  exit 0
}

Write-Host ""
Write-Host "Checksum manifests were unreachable or incompatible:" -ForegroundColor Yellow
$errors | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
Write-Host ""
Write-Host "Falling back to offline archive validation plus Windows Authenticode verification." -ForegroundColor Yellow
Write-Host "The executable is extracted to a temporary probe directory but is not executed."
Test-AuthenticodeElectron -ArchivePath $ZipPath -ExpectedVersion $Version -WorkingDirectory $CacheDir | Out-Null
Write-Host "Archive structure and Authenticode verification passed." -ForegroundColor Green
Write-Host "Downloaded ZIP SHA-256: $actual"
exit 0
