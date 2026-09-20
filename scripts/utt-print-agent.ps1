$ErrorActionPreference = 'Stop'
$BaseUrl = 'https://unitedtraffictickets.com'
$Token = [Environment]::GetEnvironmentVariable('UTT_PRINT_AGENT_TOKEN','Machine')
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = [Environment]::GetEnvironmentVariable('UTT_PRINT_AGENT_TOKEN','User') }
if ([string]::IsNullOrWhiteSpace($Token)) { throw 'UTT_PRINT_AGENT_TOKEN is not configured.' }
$TempDir = Join-Path $env:LOCALAPPDATA 'UnitedTrafficTickets\\PrintQueue'
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$headers = @{ Authorization = 'Bearer ' + $Token }

while ($true) {
  try {
    $response = Invoke-WebRequest -Uri ($BaseUrl + '/api/print-queue') -Headers $headers -Method Get -TimeoutSec 30 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
      $jobId = $response.Headers['X-Print-Job-Id']
      $filename = $response.Headers['X-Print-Filename']
      if ([string]::IsNullOrWhiteSpace($jobId)) { throw 'Print queue response did not include a job id.' }
      if ([string]::IsNullOrWhiteSpace($filename)) { $filename = 'TR-205.pdf' }
      $safe = ($filename -replace '[^A-Za-z0-9._ -]','_')
      $pdf = Join-Path $TempDir ($jobId + '_' + $safe)
      [IO.File]::WriteAllBytes($pdf, $response.Content)
      try {
        Start-Process -FilePath $pdf -Verb Print -Wait
        Invoke-RestMethod -Uri ($BaseUrl + '/api/print-queue') -Headers $headers -Method Post -ContentType 'application/json' -Body (@{ id=$jobId; status='printed' } | ConvertTo-Json) | Out-Null
        Remove-Item $pdf -Force -ErrorAction SilentlyContinue
      } catch {
        $msg = $_.Exception.Message
        try { Invoke-RestMethod -Uri ($BaseUrl + '/api/print-queue') -Headers $headers -Method Post -ContentType 'application/json' -Body (@{ id=$jobId; status='failed'; error=$msg } | ConvertTo-Json) | Out-Null } catch {}
        throw
      }
    }
  } catch {
    Start-Sleep -Seconds 15
  }
  Start-Sleep -Seconds 5
}
