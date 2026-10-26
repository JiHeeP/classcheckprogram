# 수학 확인 팝업 + 트레이 아이콘 (학교 PC용)
#   - 수학 확인 화면을 Edge 작은 창으로 띄우고, 작업 표시줄 오른쪽 트레이 아이콘 메뉴로 다룬다
#   - 메뉴: 보이기/숨기기 · 항상 위에 고정 · 자리 고정 · 자리 옮기기 · 크기 · 로그인 시 자동 실행 · 종료
#   - 이미 켜져 있을 때 다시 실행하면(아침 8:30 예약) 창을 닫았다 새로 열어 오늘 화면으로 바꾼다
# 직접 실행하지 말고 open_math_popup.bat (수학확인_팝업_등록.bat 이 만들어 줌)으로 실행한다.
# 이 파일은 UTF-8(BOM) 이어야 한글 메뉴가 깨지지 않는다.
param(
  [string]$Site = '',
  [string]$Pos = 'tr',
  [int]$W = 560,
  [int]$H = 620,
  [switch]$Quit
)

$ErrorActionPreference = 'Stop'
$titleMark = '수학 확인 팝업'            # 화면(app.js)이 정하는 창 제목의 앞부분
$runName = 'ClassroomMathPopup'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class W32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  // Edge 앱 창(Chrome_WidgetWin_1) 중 제목이 mark 로 시작하는 것. 숨겨진 창도 찾는다.
  public static IntPtr Find(string mark) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      StringBuilder cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      StringBuilder t = new StringBuilder(256);
      GetWindowText(h, t, 256);
      if (t.ToString().StartsWith(mark)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
# 화면 배율(125% 등)이 있어도 창 좌표가 어긋나지 않게, 창을 만들기 전에 먼저 켠다
[void][W32]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---- 한 번에 하나만: 이미 켜져 있으면 그쪽에 신호만 보내고 끝낸다 ----
$showEvt = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::AutoReset, 'Local\ClassroomMathPopupShow')
$quitEvt = New-Object System.Threading.EventWaitHandle($false, [System.Threading.EventResetMode]::AutoReset, 'Local\ClassroomMathPopupQuit')
if ($Quit) {
  [void]$quitEvt.Set()
  exit
}
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\ClassroomMathPopupTray', [ref]$created)
if (-not $created) {
  [void]$showEvt.Set()
  exit
}
[void]$showEvt.Reset()
[void]$quitEvt.Reset()

$base = $Site.Trim().TrimEnd('/')
if (-not $base) {
  [void][System.Windows.Forms.MessageBox]::Show('Site address is missing. Run the setup file again.', 'Math check popup')
  exit
}

# ---- 저장되는 설정 (%APPDATA%\ClassroomMathPopup\settings.json) ----
$dir = Join-Path $env:APPDATA 'ClassroomMathPopup'
$file = Join-Path $dir 'settings.json'
$cfg = @{ pinned = $true; locked = $false; x = $null; y = $null; w = $null; h = $null }
if (Test-Path $file) {
  try {
    $saved = Get-Content -Path $file -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @('pinned', 'locked', 'x', 'y', 'w', 'h')) {
      if ($null -ne $saved.$k) { $cfg[$k] = $saved.$k }
    }
  } catch { }
}
function Save-Cfg {
  try {
    if (-not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
    ($cfg | ConvertTo-Json -Compress) | Set-Content -Path $file -Encoding UTF8
  } catch { }
}

$g0 = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
$scale = $g0.DpiX / 96.0
$g0.Dispose()

$script:hwnd = [IntPtr]::Zero
$script:placed = $false
$script:lastSeen = ''
$script:stable = 0
$script:startedAt = Get-Date

# ---- 창 다루기 ----
$NOZORDER_NOACTIVATE = 0x0014
$TOPMOST_FLAGS = 0x0013               # NOMOVE | NOSIZE | NOACTIVATE
$script:HWND_TOPMOST = [IntPtr](-1)
$script:HWND_NOTOPMOST = [IntPtr](-2)

function Get-Rect {
  $r = New-Object W32+RECT
  [void][W32]::GetWindowRect($script:hwnd, [ref]$r)
  return @{ x = $r.Left; y = $r.Top; w = ($r.Right - $r.Left); h = ($r.Bottom - $r.Top) }
}

function Move-Popup([int]$x, [int]$y, [int]$w, [int]$h) {
  [void][W32]::SetWindowPos($script:hwnd, [IntPtr]::Zero, $x, $y, $w, $h, $NOZORDER_NOACTIVATE)
  $cfg.x = $x; $cfg.y = $y; $cfg.w = $w; $cfg.h = $h
  Save-Cfg
}

function Get-WorkArea {
  if ($script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) {
    return [System.Windows.Forms.Screen]::FromHandle($script:hwnd).WorkingArea
  }
  return [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
}

# 작업 영역(작업 표시줄 제외) 모서리에 붙이기: tr br tl bl c
function Move-ToCorner([string]$pos, [int]$w, [int]$h) {
  $wa = Get-WorkArea
  $m = [int](16 * $scale)
  if ($pos -eq 'c') { $x = $wa.Left + [int](($wa.Width - $w) / 2) }
  elseif ($pos.Contains('l')) { $x = $wa.Left + $m }
  else { $x = $wa.Right - $w - $m }
  if ($pos -eq 'c') { $y = $wa.Top + [int](($wa.Height - $h) / 2) }
  elseif ($pos.StartsWith('b')) { $y = $wa.Bottom - $h - $m }
  else { $y = $wa.Top + $m }
  Move-Popup $x $y $w $h
}

function Set-Size([int]$lw, [int]$lh) {
  $r = Get-Rect
  $wa = Get-WorkArea
  $w = [int]($lw * $scale); $h = [int]($lh * $scale)
  $x = [Math]::Max($wa.Left, [Math]::Min($r.x, $wa.Right - $w))
  $y = [Math]::Max($wa.Top, [Math]::Min($r.y, $wa.Bottom - $h))
  Move-Popup $x $y $w $h
}

function Set-Topmost([bool]$on) {
  $after = if ($on) { $script:HWND_TOPMOST } else { $script:HWND_NOTOPMOST }
  [void][W32]::SetWindowPos($script:hwnd, $after, 0, 0, 0, 0, $TOPMOST_FLAGS)
}

function Start-Popup {
  $url = "$base/?popup=1&pos=keep"
  $edgeArgs = @("--app=$url", "--window-size=$W,$H")
  try {
    Start-Process -FilePath 'msedge' -ArgumentList $edgeArgs
  } catch {
    $exe = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
    if (-not (Test-Path $exe)) { $exe = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
    Start-Process -FilePath $exe -ArgumentList $edgeArgs
  }
  $script:hwnd = [IntPtr]::Zero
  $script:placed = $false
  $script:startedAt = Get-Date
}

function Close-Popup {
  if ($script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) {
    [void][W32]::PostMessage($script:hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)   # WM_CLOSE
  }
  $script:hwnd = [IntPtr]::Zero
}

# 창을 처음 찾았을 때: 저장된 자리(없으면 고른 모서리)로 옮기고 항상 위를 건다
function Place-First {
  if ($null -ne $cfg.x) {
    Move-Popup ([int]$cfg.x) ([int]$cfg.y) ([int]$cfg.w) ([int]$cfg.h)
  } else {
    Move-ToCorner $Pos ([int]($W * $scale)) ([int]($H * $scale))
  }
  Set-Topmost ([bool]$cfg.pinned)
  $script:placed = $true
}

function Toggle-Popup {
  if ($script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) {
    if ([W32]::IsIconic($script:hwnd)) {
      [void][W32]::ShowWindow($script:hwnd, 9)                 # SW_RESTORE
    } elseif ([W32]::IsWindowVisible($script:hwnd)) {
      [void][W32]::ShowWindow($script:hwnd, 0)                 # SW_HIDE
    } else {
      [void][W32]::ShowWindow($script:hwnd, 5)                 # SW_SHOW
      [void][W32]::SetForegroundWindow($script:hwnd)
    }
  } else {
    Start-Popup                                                # 창을 닫았었다면 새로 연다
  }
}

# ---- 로그인 시 자동 실행 (Run 키: 관리자 권한 필요 없음) ----
function Get-AutoRun {
  $v = Get-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  return [bool]$v
}
function Set-AutoRun([bool]$on) {
  if ($on) {
    $bat = Join-Path (Split-Path -Parent $PSCommandPath) 'open_math_popup.bat'
    if (Test-Path $bat) {
      $cmd = '"' + $bat + '"'
    } else {
      $cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Site "' + $base + '" -Pos ' + $Pos + ' -W ' + $W + ' -H ' + $H
    }
    Set-ItemProperty -Path $runKey -Name $runName -Value $cmd
  } else {
    Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  }
}

# ---- 트레이 아이콘과 메뉴 ----
function New-TrayIcon {
  try {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(30, 58, 95))
    $g.FillEllipse($brush, 1, 1, 30, 30)
    $font = New-Object System.Drawing.Font('Malgun Gothic', 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $g.DrawString([string][char]0xC218, $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, 1, 32, 32), $sf)
    $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  } catch {
    return [System.Drawing.SystemIcons]::Information
  }
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = New-TrayIcon
$tray.Text = $titleMark
$menu = New-Object System.Windows.Forms.ContextMenuStrip

function Add-Item($parent, [string]$text, $handler, [bool]$check = $false) {
  $it = New-Object System.Windows.Forms.ToolStripMenuItem($text)
  $it.CheckOnClick = $check
  if ($handler) { $it.Add_Click($handler) }
  if ($parent -is [System.Windows.Forms.ToolStripDropDownItem]) { [void]$parent.DropDownItems.Add($it) }
  else { [void]$parent.Items.Add($it) }
  return $it
}

[void](Add-Item $menu '보이기 / 숨기기' { Toggle-Popup })

$pinItem = Add-Item $menu '항상 위에 고정' {
  param($s, $e)
  $cfg.pinned = $s.Checked
  Save-Cfg
  if ($script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) { Set-Topmost $s.Checked }
} $true

$lockItem = Add-Item $menu '자리 고정 (끌어도 제자리로)' {
  param($s, $e)
  $cfg.locked = $s.Checked
  if ($s.Checked -and $script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) {
    $r = Get-Rect                                  # 지금 자리를 기억해 두고 그 자리로 고정
    $cfg.x = $r.x; $cfg.y = $r.y; $cfg.w = $r.w; $cfg.h = $r.h
  }
  Save-Cfg
} $true

$moveMenu = Add-Item $menu '자리 옮기기' $null
$corners = @(
  @('오른쪽 위', 'tr'), @('오른쪽 아래', 'br'), @('왼쪽 위', 'tl'), @('왼쪽 아래', 'bl'), @('가운데', 'c')
)
foreach ($c in $corners) {
  $it = Add-Item $moveMenu $c[0] {
    param($s, $e)
    if ($script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) {
      $r = Get-Rect
      Move-ToCorner $s.Tag $r.w $r.h
    }
  }
  $it.Tag = $c[1]
}

$sizeMenu = Add-Item $menu '크기' $null
$sizes = @(
  @('작게', 480, 520), @('보통', 560, 620), @('크게', 720, 780)
)
foreach ($z in $sizes) {
  $it = Add-Item $sizeMenu $z[0] {
    param($s, $e)
    if ($script:hwnd -ne [IntPtr]::Zero -and [W32]::IsWindow($script:hwnd)) {
      Set-Size $s.Tag[0] $s.Tag[1]
    }
  }
  $it.Tag = @($z[1], $z[2])
}

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$autoItem = Add-Item $menu '로그인 시 자동 실행' {
  param($s, $e)
  try { Set-AutoRun $s.Checked } catch { $s.Checked = Get-AutoRun }
} $true

function Exit-App {
  $timer.Stop()
  Close-Popup
  $tray.Visible = $false
  $tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
}
[void](Add-Item $menu '종료' { Exit-App })

$menu.Add_Opening({
  # 열 때마다 지금 상태를 체크 표시에 맞춘다
  $pinItem.Checked = [bool]$cfg.pinned
  $lockItem.Checked = [bool]$cfg.locked
  $autoItem.Checked = Get-AutoRun
})
$tray.ContextMenuStrip = $menu
$tray.Add_MouseClick({
  param($s, $e)
  if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Toggle-Popup }
})
$tray.Visible = $true

# ---- 0.5초마다: 창 찾기 · 항상 위 유지 · 자리 고정/기억 ----
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  try {
    if ($quitEvt.WaitOne(0)) { Exit-App; return }
    if ($showEvt.WaitOne(0)) {
      # 아침 예약이 다시 실행됨: 닫았다가 새로 열어 오늘 화면으로
      Close-Popup
      Start-Sleep -Milliseconds 800
      Start-Popup
      return
    }
    if ($script:hwnd -eq [IntPtr]::Zero -or -not [W32]::IsWindow($script:hwnd)) {
      $script:hwnd = [W32]::Find($titleMark)
      $script:placed = $false
    }
    if ($script:hwnd -eq [IntPtr]::Zero) { return }
    if (-not $script:placed) { Place-First; return }
    if (-not [W32]::IsWindowVisible($script:hwnd) -or [W32]::IsIconic($script:hwnd) -or [W32]::IsZoomed($script:hwnd)) { return }

    $isTop = ([W32]::GetWindowLong($script:hwnd, -20) -band 0x8) -ne 0      # WS_EX_TOPMOST
    if ([bool]$cfg.pinned -ne $isTop) { Set-Topmost ([bool]$cfg.pinned) }

    $r = Get-Rect
    $same = $null -ne $cfg.x -and [Math]::Abs($r.x - [int]$cfg.x) -le 2 -and [Math]::Abs($r.y - [int]$cfg.y) -le 2 `
      -and [Math]::Abs($r.w - [int]$cfg.w) -le 2 -and [Math]::Abs($r.h - [int]$cfg.h) -le 2
    if ($same) { $script:stable = 0; return }
    if ($cfg.locked -and $null -ne $cfg.x) {
      [void][W32]::SetWindowPos($script:hwnd, [IntPtr]::Zero, [int]$cfg.x, [int]$cfg.y, [int]$cfg.w, [int]$cfg.h, $NOZORDER_NOACTIVATE)
      return
    }
    # 고정이 꺼져 있으면 옮긴 자리·크기를 기억 (멈춘 지 1초 뒤에 저장)
    $key = "$($r.x),$($r.y),$($r.w),$($r.h)"
    if ($key -eq $script:lastSeen) { $script:stable++ } else { $script:lastSeen = $key; $script:stable = 0 }
    if ($script:stable -ge 2) {
      $cfg.x = $r.x; $cfg.y = $r.y; $cfg.w = $r.w; $cfg.h = $r.h
      Save-Cfg
      $script:stable = 0
    }
  } catch { }
})

Start-Popup
$timer.Start()
try {
  [System.Windows.Forms.Application]::Run()
} finally {
  try { $mutex.ReleaseMutex() } catch { }
}
