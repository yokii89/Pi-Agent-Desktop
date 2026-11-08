# 生成 NSIS 安装器的品牌位图 —— 方案二「晴空 · 浅色向导」（2026-11-08 设计确认）。
# 仅在调整安装器美术时手动运行（pnpm run gen:installer-art）；日常构建直接使用
# build/ 下已提交的 BMP 产物。用 GDI+ 而非浏览器渲染，是为了零新增依赖。
#
# NSIS 对位图的尺寸是硬性要求：侧栏 164×314、页眉 150×57；electron-builder 也只收 BMP。
# 改尺寸 / 配色 / 文案先改下面的常量再重新生成，产物必须随仓库提交。

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $repoRoot "build"
$iconPath = Join-Path $buildDir "icon.png"
if (-not (Test-Path $iconPath)) { throw "missing icon master: $iconPath" }

# ---- 色板（与桌面端浅色主题 / pi 品牌色对齐）----
$col = @{
  bgTop      = [System.Drawing.Color]::FromArgb(255, 0xFC, 0xFD, 0xFF)
  bgBottom   = [System.Drawing.Color]::FromArgb(255, 0xED, 0xF0, 0xF6)
  waveCoral  = [System.Drawing.Color]::FromArgb(36, 0xF0, 0x90, 0x82)   # 0.14
  waveBlue   = [System.Drawing.Color]::FromArgb(28, 0x4D, 0x9A, 0xBF)   # 0.11
  ink        = [System.Drawing.Color]::FromArgb(255, 0x1D, 0x1D, 0x21)
  textMuted  = [System.Drawing.Color]::FromArgb(255, 0x7D, 0x7D, 0x84)
  textCoral  = [System.Drawing.Color]::FromArgb(255, 0xC2, 0x60, 0x4E)
  coral      = [System.Drawing.Color]::FromArgb(255, 0xF0, 0x90, 0x82)
  coralSoft  = [System.Drawing.Color]::FromArgb(140, 0xF0, 0x90, 0x82)  # 0.55
  cardStroke = [System.Drawing.Color]::FromArgb(255, 0xE4, 0xE8, 0xF0)
  cardRail   = [System.Drawing.Color]::FromArgb(255, 0xF4, 0xF6, 0xFA)
  dotMuted   = [System.Drawing.Color]::FromArgb(255, 0xD9, 0xDE, 0xE8)
  lineSoft   = [System.Drawing.Color]::FromArgb(255, 0xEC, 0xEF, 0xF5)
  lineMid    = [System.Drawing.Color]::FromArgb(255, 0xE6, 0xEA, 0xF1)
}

function New-Solid([System.Drawing.Color]$c) { New-Object System.Drawing.SolidBrush $c }

# 圆角矩形路径（r 为角半径，其余同 SVG rect rx）
function New-RoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2.0
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return ,$p
}

# 波浪底边路径：一条三次贝塞尔 + 右/下/左三条直线闭合
function New-WavePath([float]$y0, [float]$c1y, [float]$c2y, [float]$y1) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddBezier(0, $y0, 42, $c1y, 84, $c2y, 164, $y1)
  $p.AddLine(164, $y1, 164, 314)
  $p.AddLine(164, 314, 0, 314)
  $p.CloseFigure()
  return ,$p
}

# 按基线 y 画文字：DrawString 以行盒顶定位，这里换算成 baseline - ascent
function Draw-TextAtBaseline([System.Drawing.Graphics]$g, [string]$text, [System.Drawing.Font]$font,
  [System.Drawing.Brush]$brush, [float]$x, [float]$baselineY) {
  $fam = $font.FontFamily
  $style = $font.Style
  $ascent = $font.Size * $fam.GetCellAscent($style) / $fam.GetEmHeight($style)
  $g.DrawString($text, $font, $brush, $x, $baselineY - $ascent)
}

function New-DefaultGraphics([System.Drawing.Bitmap]$bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  return $g
}

# 画应用 logo（icon.png 自带圆角透明底；TileFlipXY 消除边缘插值白边）
function Draw-Logo([System.Drawing.Graphics]$g, [System.Drawing.Image]$icon, [float]$x, [float]$y, [float]$size) {
  $ia = New-Object System.Drawing.Imaging.ImageAttributes
  $ia.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dst = [System.Drawing.Rectangle]::new([int]$x, [int]$y, [int]$size, [int]$size)
  $g.DrawImage($icon, $dst, 0, 0, $icon.Width, $icon.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
}

$icon = [System.Drawing.Image]::FromFile($iconPath)

# ================= 侧栏图 164×314（欢迎页 / 完成页左栏） =================
$bmp = New-Object System.Drawing.Bitmap 164, 314, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-DefaultGraphics $bmp

# 底色：竖向浅色渐变
$bgRect = [System.Drawing.Rectangle]::new(0, 0, 164, 314)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $col.bgTop, $col.bgBottom, 90)
$g.FillRectangle($bgBrush, $bgRect)

# 双色波浪（下 1/3）
$wave1 = New-WavePath 242 224 254 228
$g.FillPath((New-Solid $col.waveCoral), $wave1)
$wave1.Dispose()
$wave2 = New-WavePath 272 250 282 258
$g.FillPath((New-Solid $col.waveBlue), $wave2)
$wave2.Dispose()

# logo + 产品名 + 标语（左对齐栏式）
Draw-Logo $g $icon 20 40 52
$nameFont = New-Object System.Drawing.Font("Segoe UI Semibold", 20, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
Draw-TextAtBaseline $g "PiDesk" $nameFont (New-Solid $col.ink) 20 124
$tagFont = New-Object System.Drawing.Font("Microsoft YaHei UI", 10.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
Draw-TextAtBaseline $g "pi 的 Windows 桌面客户端" $tagFont (New-Solid $col.textMuted) 20 143

# 应用界面剪影卡（白卡 + 侧栏轨 + 正文行 + 输入条）
$card = New-RoundRectPath 20 176 124 64 9
$g.FillPath((New-Solid ([System.Drawing.Color]::White)), $card)
$g.DrawPath((New-Object System.Drawing.Pen($col.cardStroke, 1)), $card)
$card.Dispose()
$rail = New-RoundRectPath 30 186 14 44 4
$g.FillPath((New-Solid $col.cardRail), $rail)
$rail.Dispose()
$g.FillEllipse((New-Solid $col.coral), 34.5, 193.5, 5, 5)
$g.FillEllipse((New-Solid $col.dotMuted), 34.5, 204.5, 5, 5)
$g.FillEllipse((New-Solid $col.dotMuted), 34.5, 215.5, 5, 5)
$ln1 = New-RoundRectPath 52 190 52 6 3
$g.FillPath((New-Solid $col.lineSoft), $ln1); $ln1.Dispose()
$ln2 = New-RoundRectPath 52 202 64 6 3
$g.FillPath((New-Solid $col.lineMid), $ln2); $ln2.Dispose()
$ln3 = New-RoundRectPath 52 214 46 6 3
$g.FillPath((New-Solid $col.lineMid), $ln3); $ln3.Dispose()
$pillIn = New-RoundRectPath 52 224 58 10 5
$g.FillPath((New-Solid $col.cardRail), $pillIn)
$g.DrawPath((New-Object System.Drawing.Pen($col.cardStroke, 1)), $pillIn)
$pillIn.Dispose()
$g.FillEllipse((New-Solid $col.coral), 57, 227, 4, 4)

# 版本胶囊（文案不写死版本号，避免每次发版都要重生成美术）
$verPill = New-RoundRectPath 20 252 96 22 11
$g.FillPath((New-Solid ([System.Drawing.Color]::White)), $verPill)
$g.DrawPath((New-Object System.Drawing.Pen($col.coralSoft, 1)), $verPill)
$verPill.Dispose()
$verFont = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$verText = "Windows · x64"
$verSize = $g.MeasureString($verText, $verFont)
$verTop = 252 + (22 - $verSize.Height) / 2.0
$g.DrawString($verText, $verFont, (New-Solid $col.textCoral), 20 + (96 - $verSize.Width) / 2.0, $verTop)

$g.Dispose()
$bmp.Save((Join-Path $buildDir "installerSidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

# ================= 页眉图 150×57（中间页右上角横幅） =================
$bmp = New-Object System.Drawing.Bitmap 150, 57, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-DefaultGraphics $bmp
$g.Clear($col.bgTop)

Draw-Logo $g $icon 14 16 25
$headNameFont = New-Object System.Drawing.Font("Segoe UI Semibold", 13, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
Draw-TextAtBaseline $g "PiDesk" $headNameFont (New-Solid $col.ink) 47 30
$under = New-RoundRectPath 47 35 36 2.5 1.25
$g.FillPath((New-Solid $col.coral), $under)
$under.Dispose()
$headSubFont = New-Object System.Drawing.Font("Microsoft YaHei UI", 8.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
Draw-TextAtBaseline $g "安装向导" $headSubFont (New-Solid $col.textMuted) 47 48

$g.Dispose()
$bmp.Save((Join-Path $buildDir "installerHeader.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

$icon.Dispose()

# 自检：读回尺寸，NSIS 对这两档尺寸是硬性要求
foreach ($f in @("installerSidebar.bmp", "installerHeader.bmp")) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $buildDir $f))
  Write-Host "$f => $($img.Width)x$($img.Height)"
  $img.Dispose()
}
