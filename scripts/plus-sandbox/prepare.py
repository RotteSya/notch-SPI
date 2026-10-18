#!/usr/bin/env python3
"""Build an isolated source-copy fixture; never patch the release source tree."""
from pathlib import Path
import shutil, subprocess, plistlib, json, hashlib, shlex, os
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/plus-native-sandbox'; SRC=OUT/'source'; APP=OUT/'NotchSPI Plus Sandbox.app'
BUNDLE='com.rottesya.notchspi.plus-sandbox'
OUT.mkdir(parents=True,exist_ok=True);SRC.mkdir(exist_ok=True)
for name in ['Sources','Tests','Vendor']:
 shutil.copytree(ROOT/name,SRC/name,dirs_exist_ok=True)
for name in ['Package.swift','Package.resolved']:
 shutil.copy2(ROOT/name,SRC/name)
changes=[]
def patch(path,old,new):
 p=SRC/path;s=p.read_text();assert old in s,path
 p.write_text(s.replace(old,new));changes.append(path)
patch('Sources/NotchSPI/Settings/KeychainStore.swift','private static let service = "com.rottesya.notchspi"','private static let service = "'+BUNDLE+'"')
patch('Sources/NotchSPI/History/RecentQuestions.swift','"NotchSPI/RecentQuestions"','"NotchSPI-Plus-Sandbox/RecentQuestions"')
patch('Sources/NotchSPI/Cloud/ProductTelemetry.swift','.appendingPathComponent("NotchSPI",','.appendingPathComponent("NotchSPI-Plus-Sandbox",')
patch('Sources/NotchSPI/App/AppDelegate.swift','$0.scheme == "notchspi"','$0.scheme == "notchspi-sandbox"')
patch('Sources/NotchSPI/Cloud/OfficialAPI.swift','static let defaultBaseURL = "https://notchspi-api.vercel.app"','static let defaultBaseURL = "http://127.0.0.1:43081"')
patch('Sources/NotchSPI/App/DevelopmentIsolation.swift','''        if bundleID == devBundleID {
            guard let raw = launchArgument''','''        if bundleID == "'''+BUNDLE+'''" { return "http://127.0.0.1:43081" }
        if bundleID == devBundleID {
            guard let raw = launchArgument''')
patch('Sources/NotchSPI/App/DevelopmentIsolation.swift','''        let clean = path.hasPrefix''','''        if bundleID == "'''+BUNDLE+'''" { return URL(string: "http://127.0.0.1:43081")!.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path) }
        let clean = path.hasPrefix''')
patch('Sources/NotchSPI/App/DevelopmentIsolation.swift','''        if let launch = launchChannel''','''        if bundleID == "'''+BUNDLE+'''" { return ServiceMode.official }
        if let launch = launchChannel''')
patch('Sources/NotchSPI/Update/UpdateChecker.swift','''    static func check(completion: @escaping (CheckResult) -> Void) {''','''    static func check(completion: @escaping (CheckResult) -> Void) {
        guard Bundle.main.bundleIdentifier != "'''+BUNDLE+'''" else { completion(.failed("隔离沙箱不提供应用更新")); return }''')
patch('Sources/NotchSPI/App/main.swift','import Darwin','''import Darwin
// This fixture must not run under the production identity or ephemeral QA mode.
guard Bundle.main.bundleIdentifier == "'''+BUNDLE+'''" else { exit(78) }
unsetenv("NSPI_QA_EPHEMERAL")
UserDefaults.standard.set("official", forKey: "serviceMode")
''')
subprocess.run(['swift','build','--package-path',str(SRC),'-Xswiftc','-warnings-as-errors'],check=True)
binpath=Path(subprocess.check_output(['swift','build','--package-path',str(SRC),'--show-bin-path'],text=True).strip())
(APP/'Contents/MacOS').mkdir(parents=True,exist_ok=True);res=APP/'Contents/Resources';res.mkdir(exist_ok=True)
shutil.copy2(binpath/'NotchSPI',APP/'Contents/MacOS/NotchSPI')
shutil.copytree(binpath/'SwiftMath_SwiftMath.bundle',res/'SwiftMath_SwiftMath.bundle',dirs_exist_ok=True)
shutil.copytree(ROOT/'Resources/ThirdParty',res/'ThirdParty',dirs_exist_ok=True)
info={'CFBundleIdentifier':BUNDLE,'CFBundleExecutable':'NotchSPI','CFBundleName':'NotchSPI Plus Sandbox','CFBundleDisplayName':'NotchSPI Plus Sandbox','CFBundlePackageType':'APPL','CFBundleShortVersionString':'3.0','CFBundleVersion':'26','LSMinimumSystemVersion':'14.0','NSHighResolutionCapable':True,'NSAppTransportSecurity':{'NSAllowsLocalNetworking':True},'NSScreenCaptureUsageDescription':'隔离测试：截图用于本机模拟查题，不提交给真实模型。','CFBundleURLTypes':[{'CFBundleURLName':BUNDLE,'CFBundleURLSchemes':['notchspi-sandbox']}]}
(APP/'Contents/Info.plist').write_bytes(plistlib.dumps(info))
subprocess.run(['codesign','--force','--sign','-','--timestamp=none',str(APP)],check=True)
subprocess.run(['codesign','--verify','--strict',str(APP)],check=True)
for name,action in [('启动沙箱.command','start'),('停止沙箱.command','stop'),('检查沙箱.command','status')]:
 p=OUT/name;p.write_text('#!/bin/zsh\ncd '+shlex.quote(str(ROOT))+'\n'+shlex.quote(shutil.which('node'))+' '+shlex.quote(str(ROOT/'scripts/plus-sandbox/control.mjs'))+' '+action+'\nprintf "\\n按回车关闭窗口…"\nread answer\n');p.chmod(0o755)
(OUT/'build-manifest.json').write_text(json.dumps({'bundle_id':BUNDLE,'scheme':'notchspi-sandbox','base_url':'http://127.0.0.1:43081','fixture_only':True,'modified_source_copies':sorted(set(changes)),'executable_sha256':hashlib.sha256((APP/'Contents/MacOS/NotchSPI').read_bytes()).hexdigest()},indent=2)+'\n')
print('Ready:',APP)
