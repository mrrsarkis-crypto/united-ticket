$ErrorActionPreference = "Stop"
$idxPath = "C:\Users\arpin\united-ticket\public\index.html"
$idx = [IO.File]::ReadAllText($idxPath)

$oldTop = '<span class="topbar-tag">Serving drivers across California &amp; nationwide</span>'
$newTop = '<span class="topbar-tag">Serving drivers across California &amp; nationwide · Super Bowl &amp; Olympics community initiatives</span>'
if ($idx.Contains($oldTop)) { $idx = $idx.Replace($oldTop, $newTop); Write-Host "topbar patched" }
elseif ($idx -match 'Super Bowl') { Write-Host "topbar already has Super Bowl" }
else { Write-Host "topbar pattern not found" }

if ($idx -match '<h3>Standard Ticket</h3>' -and $idx -notmatch 'Fight by TBD') {
  $pattern = '(?s)<div class="card price">\s*<h3>Standard Ticket</h3>.*?</div>(\s*)(?=<div class="card price)'
  $replacement = @"
<div class="card price hot">
          <h3>Standard Ticket — Fight by TBD</h3>
          <div class="amount">`$199</div>
          <p>Trial by Written Declaration (TR-205) prep + case tracking. Court-referred document prep pathway — not a law firm; outcomes not guaranteed.</p>
          <a class="btn btn-amber" href="/bot-courthouse?path=tbd" data-utt-service="199">Fight TBD — `$199</a>
          <a href="/assistant?service=199&amp;intent=tbd" style="display:block;margin-top:10px;font-weight:700;">Or scan free first</a>
        </div>`$1
"@
  $idx2 = [regex]::Replace($idx, $pattern, $replacement, 1)
  if ($idx2 -ne $idx) { $idx = $idx2; Write-Host "pricing card patched" } else { Write-Host "pricing regex no match" }
} elseif ($idx -match 'Fight by TBD') { Write-Host "pricing already TBD" }
else { Write-Host "pricing pattern not found" }

if ($idx -notmatch 'Verify on Cal eProcure') {
  $trust = @"

<section class="bc-trust-strip" aria-label="Trust and credibility" style="padding:18px 0;background:#F7F9FE;border-bottom:1px solid #D8E1F0;">
  <div class="wrap">
    <div style="height:4px;border-radius:999px;margin-bottom:14px;background:linear-gradient(90deg,#D90012,#0033A0,#F2A800);"></div>
    <p style="margin:0 0 12px;font-size:14px;color:#102A5B;"><strong>State SBE-certified</strong> · <strong>court-referred</strong> · Super Bowl &amp; Olympics initiatives — not a government agency or law firm.</p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#5D6E8D;">
      California Small Business Enterprise #2053854 —
      <a href="https://caleprocure.ca.gov/pages/PublicSearch/supplier-search.aspx" target="_blank" rel="noopener">Verify on Cal eProcure</a> ·
      <a href="https://www.dgs.ca.gov/PD-OSDS" target="_blank" rel="noopener">DGS OSDS</a> ·
      <a href="https://opengovus.com/los-angeles-business/0002438818-0001-2" target="_blank" rel="noopener">LA City business record</a> ·
      Partner traffic school: <a href="/go/myimprov">myimprov</a> (CA DMV E1515)
    </p>
  </div>
</section>
"@
  $idx = $idx.Replace('</header>', '</header>' + $trust)
  Write-Host "trust strip inserted"
} else { Write-Host "trust strip already present" }

[IO.File]::WriteAllText($idxPath, $idx)
Write-Host "done index length $($idx.Length)"
