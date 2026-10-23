param([long]$WindowId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class NSPIWindowBounds {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out RECT rect,int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  public static int[] Read(long id) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    RECT r; if(DwmGetWindowAttribute(new IntPtr(id),9,out r,16)!=0 && !GetWindowRect(new IntPtr(id),out r)) throw new Exception("Window unavailable");
    return new int[]{r.left,r.top,r.right-r.left,r.bottom-r.top};
  }
}
'@
[NSPIWindowBounds]::Read($WindowId) | ConvertTo-Json -Compress
