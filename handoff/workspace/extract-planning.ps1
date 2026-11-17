Add-Type -AssemblyName System.IO.Compression.FileSystem
$inputPath='D:\Vibe\(원민철)드림AI_바이브코딩_비즈니스_사이트_기획서_디자인_v2_개발용.xlsx'
$zip=[IO.Compression.ZipFile]::OpenRead($inputPath)
function Read-XmlEntry($entryName) { $r=[IO.StreamReader]::new($zip.GetEntry($entryName).Open()); try { [xml]$r.ReadToEnd() } finally { $r.Dispose() } }
$shared=Read-XmlEntry 'xl/sharedStrings.xml'
$strings=@($shared.sst.si | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' })
$wb=Read-XmlEntry 'xl/workbook.xml'
$output=for($i=1;$i -le 5;$i++) { $sheet=Read-XmlEntry "xl/worksheets/sheet$i.xml"; "`n=== $($wb.workbook.sheets.sheet[$i-1].name) ==="; foreach($row in $sheet.worksheet.sheetData.row) { $cells=foreach($c in $row.c) { $valueNode=$c.SelectSingleNode('./*[local-name()="v"]'); $v=if($valueNode){$valueNode.InnerText}else{''}; if($c.t -eq 's'){$v=$strings[[int]$v]} elseif($c.t -eq 'inlineStr'){$v=$c.InnerText}; if($v -ne '') { "$($c.r): $v" }; if($c.f){"FORMULA $($c.r): $($c.SelectSingleNode('./*[local-name()="f"]').InnerText)"} }; if($cells){$cells -join ' | '} } }
$zip.Dispose()
$output | Set-Content -LiteralPath 'D:\Vibe\planning-source-extracted.txt' -Encoding utf8
$output

