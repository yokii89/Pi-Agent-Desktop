# 生成 NSIS 安装/卸载向导的品牌位图：
# 安装器（安装侧栏 + 页眉）= 方案二「晴空 · 浅色向导」；卸载侧栏 = 方案一「同源告别 · 幽灵卡」。
# 仅在调整安装器美术时手动运行（pnpm run gen:installer-art）；日常构建直接使用
# build/ 下已提交的 BMP 产物。用 GDI+ 而非浏览器渲染，是为了零新增依赖。
#
# NSIS 对位图的尺寸是硬性要求：侧栏 164×314、页眉 150×57；electron-builder 也只收 BMP。
# 改尺寸 / 配色 / 文案先改下面的常量再重新生成，产物必须随仓库提交。

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# 输出倍率：MUI2 的侧栏图控件是 109×193 对话框单位（96 DPI 下 ≈164×314 px），
# 高 DPI 下控件按比例放大，NSD_SetStretchedImage 用 LoadImage 把位图缩放到控件像素尺寸——
# 内部是近邻采样，164×314 在 150% DPI 会被粗暴放大 1.5 倍而发糊。
# 按 3× 输出（492×942）后，100% / 150% / 200% 三档常用缩放都是整数倍关系：
# 150%（本机）为干净的 2:1 下采样，位图保持锐利；下方所有绘制坐标仍按逻辑尺寸书写，
# 由 Graphics.ScaleTransform 统一放大（文字/形状/画刷都会按 3× 光栅化）。
$artScale = 3

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
  # 卸载图专属：退场波浪更淡；幽灵卡整组 55% 不透明度（alpha = 255 × 0.55）
  uWaveCoral = [System.Drawing.Color]::FromArgb(26, 0xF0, 0x90, 0x82)   # 0.10
  uWaveBlue  = [System.Drawing.Color]::FromArgb(20, 0x4D, 0x9A, 0xBF)   # 0.08
  ghostWhite = [System.Drawing.Color]::FromArgb(140, 255, 255, 255)
  ghostStroke = [System.Drawing.Color]::FromArgb(140, 0xD9, 0xDE, 0xE8)
  ghostRail  = [System.Drawing.Color]::FromArgb(140, 0xF4, 0xF6, 0xFA)
  ghostDot1  = [System.Drawing.Color]::FromArgb(140, 0xD9, 0xDE, 0xE8)
  ghostDot2  = [System.Drawing.Color]::FromArgb(140, 0xE4, 0xE8, 0xF0)
  ghostLine1 = [System.Drawing.Color]::FromArgb(140, 0xF0, 0xF2, 0xF7)
  ghostLine2 = [System.Drawing.Color]::FromArgb(140, 0xEC, 0xEF, 0xF5)
  ghostInput = [System.Drawing.Color]::FromArgb(140, 0xF7, 0xF8, 0xFB)
  ghostInputStroke = [System.Drawing.Color]::FromArgb(140, 0xE4, 0xE8, 0xF0)
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

function New-DefaultGraphics([System.Drawing.Bitmap]$bmp, [int]$scale) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  # 画布按 scale 物理像素建立，绘制坐标系仍用逻辑尺寸（见顶部 $artScale 说明）
  if ($scale -gt 1) { $g.ScaleTransform($scale, $scale) }
  return $g
}

# 画应用 logo（icon.png 自带圆角透明底；TileFlipXY 消除边缘插值白边）
function Draw-Logo([System.Drawing.Graphics]$g, [System.Drawing.Image]$icon, [float]$x, [float]$y, [float]$size) {
  $ia = New-Object System.Drawing.Imaging.ImageAttributes
  $ia.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dst = [System.Drawing.Rectangle]::new([int]$x, [int]$y, [int]$size, [int]$size)
  $g.DrawImage($icon, $dst, 0, 0, $icon.Width, $icon.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
}

# 安装/卸载侧栏图共用的品牌头部：logo + 产品名 + 标语（左对齐栏式，安装图与卸载图同源）
function Draw-BrandHeader([System.Drawing.Graphics]$g, [System.Drawing.Image]$icon) {
  Draw-Logo $g $icon 20 40 52
  $nameFont = New-Object System.Drawing.Font("Segoe UI Semibold", 20, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  Draw-TextAtBaseline $g "PiDesk" $nameFont (New-Solid $col.ink) 20 124
  $tagFont = New-Object System.Drawing.Font("Microsoft YaHei UI", 10.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  Draw-TextAtBaseline $g "pi 的 Windows 桌面客户端" $tagFont (New-Solid $col.textMuted) 20 143
}

$icon = [System.Drawing.Image]::FromFile($iconPath)

# ================= 侧栏图（逻辑 164×314，欢迎页 / 完成页左栏） =================
$bmp = [System.Drawing.Bitmap]::new(164 * $artScale, 314 * $artScale, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-DefaultGraphics $bmp $artScale

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

# logo + 产品名 + 标语（左对齐栏式，与卸载图共用 Draw-BrandHeader）
Draw-BrandHeader $g $icon

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

# ================= 页眉图（逻辑 150×57，中间页右上角横幅） =================
$bmp = [System.Drawing.Bitmap]::new(150 * $artScale, 57 * $artScale, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-DefaultGraphics $bmp $artScale
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

# ================= 卸载侧栏图（逻辑 164×314，卸载欢迎页 / 完成页左栏，方案一「同源告别 · 幽灵卡」） =================
$bmp = [System.Drawing.Bitmap]::new(164 * $artScale, 314 * $artScale, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-DefaultGraphics $bmp $artScale

# 底色与安装图同源；退场波浪比安装图更靠下、更淡
$bgRect = [System.Drawing.Rectangle]::new(0, 0, 164, 314)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, $col.bgTop, $col.bgBottom, 90)
$g.FillRectangle($bgBrush, $bgRect)
$uWave1 = New-WavePath 262 246 272 250
$g.FillPath((New-Solid $col.uWaveCoral), $uWave1)
$uWave1.Dispose()
$uWave2 = New-WavePath 286 268 296 276
$g.FillPath((New-Solid $col.uWaveBlue), $uWave2)
$uWave2.Dispose()

Draw-BrandHeader $g $icon

# 幽灵应用卡：整组 55% 不透明度 + 虚线描边、指示点熄灭——读作「正在移除」
$ghostCard = New-RoundRectPath 20 176 124 64 9
$g.FillPath((New-Solid $col.ghostWhite), $ghostCard)
$ghostPen = New-Object System.Drawing.Pen($col.ghostStroke, 1)
$ghostPen.DashPattern = [single[]]@(5, 4)
$g.DrawPath($ghostPen, $ghostCard)
$ghostPen.Dispose()
$ghostCard.Dispose()
$ghostRail = New-RoundRectPath 30 186 14 44 4
$g.FillPath((New-Solid $col.ghostRail), $ghostRail)
$ghostRail.Dispose()
$g.FillEllipse((New-Solid $col.ghostDot1), 34.5, 193.5, 5, 5)
$g.FillEllipse((New-Solid $col.ghostDot2), 34.5, 204.5, 5, 5)
$g.FillEllipse((New-Solid $col.ghostDot2), 34.5, 215.5, 5, 5)
$uln1 = New-RoundRectPath 52 190 52 6 3
$g.FillPath((New-Solid $col.ghostLine1), $uln1); $uln1.Dispose()
$uln2 = New-RoundRectPath 52 202 64 6 3
$g.FillPath((New-Solid $col.ghostLine2), $uln2); $uln2.Dispose()
$uln3 = New-RoundRectPath 52 214 46 6 3
$g.FillPath((New-Solid $col.ghostLine2), $uln3); $uln3.Dispose()
$ghostInput = New-RoundRectPath 52 224 58 10 5
$g.FillPath((New-Solid $col.ghostInput), $ghostInput)
$g.DrawPath((New-Object System.Drawing.Pen($col.ghostInputStroke, 1)), $ghostInput)
$ghostInput.Dispose()

# 告别胶囊（文案不写版本号）
$thanksPill = New-RoundRectPath 20 252 104 22 11
$g.FillPath((New-Solid ([System.Drawing.Color]::White)), $thanksPill)
$g.DrawPath((New-Object System.Drawing.Pen($col.coralSoft, 1)), $thanksPill)
$thanksPill.Dispose()
$thanksFont = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$thanksText = "感谢使用 PiDesk"
$thanksSize = $g.MeasureString($thanksText, $thanksFont)
$g.DrawString($thanksText, $thanksFont, (New-Solid $col.textCoral), 20 + (104 - $thanksSize.Width) / 2.0, 252 + (22 - $thanksSize.Height) / 2.0)

$g.Dispose()
$bmp.Save((Join-Path $buildDir "uninstallerSidebar.bmp"), [System.Drawing.Imaging.ImageFormat]::Bmp)
$bmp.Dispose()

$icon.Dispose()

# 自检：读回尺寸，NSIS 对这几档尺寸是硬性要求
foreach ($f in @("installerSidebar.bmp", "installerHeader.bmp", "uninstallerSidebar.bmp")) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $buildDir $f))
  Write-Host "$f => $($img.Width)x$($img.Height)"
  $img.Dispose()
}
