# Monica 2.9.5 静态证据

观察日期：2026-11-14（Asia/Shanghai）。平台：macOS arm64；只读挂载、静态读取，未安装/运行。

## 官方来源与包身份

官方发现页：https://monica.im/desktop

官方包：https://download.monica.im/Monica-2.9.5-arm64.dmg

DMG SHA-256：`b0a1c2b861a65871cfe29231726c0392fc22b9ffe11d842c24089666e6e8c50e`

包内 `Monica.app/Contents/Resources/app.asar` SHA-256：`cccb2d4542d77e36f8699febb99567450e18d25d2a89b603f938310f1f655c4f`

## 直接读取的元数据

```json
{
  "CFBundleIdentifier": "im.monica.desktop.monica",
  "CFBundleShortVersionString": "2.9.5",
  "CFBundleVersion": "2.9.5",
  "LSMinimumSystemVersion": "12.0",
  "NSPrincipalClass": "AtomApplication"
}
```

ASAR 中 package.json 的版本、入口及所选依赖（依赖存在不代表实际执行）：

```json
{
  "version": "2.9.5",
  "main": "./dist/background.js",
  "dependencies": {
    "electron-store": "^8.1.0",
    "electron-updater": "^6.3.0",
    "eventsource-parser": "^0.1.0",
    "express": "^4.19.2"
  }
}
```

`Contents/Resources/app-update.yml`：

```yaml
provider: s3
bucket: monica-desktop-public
region: us-east-1
updaterCacheDirName: monica-updater

```

## 与 REA 交叉验证的静态片段

ASAR 用现有 Python 标准库按头部偏移提取选定文件，没有调用目标代码。位置为解包后相对路径；偏移为 UTF-8 解码后的零起始字符位置，不是二进制地址。

### `dist/preload.js`

SHA-256：`1e3d013cb80f70e13b10ce808cfe52627efaa0d8f0c2571b23367df5b5f89a13`

- 搜索项 `noteApiHost`，字符位置 701。

```javascript
_={dev:!1,prod:!0,host:"https://monica.im",project:"monica",platform:"desktop",browser:"NA",isCn:!1,noteApiHost:"wss://note.monica.im/",realtimeApiHost:"wss://monica.im/api/realtime",realtimeApiHostV2:"wss://monica.im/api/realtime_v2"})});var _=c(a()),r=require("electron");const D
```

- 搜索项 `realtimeApiHost`，字符位置 737。

```javascript
ca.im",project:"monica",platform:"desktop",browser:"NA",isCn:!1,noteApiHost:"wss://note.monica.im/",realtimeApiHost:"wss://monica.im/api/realtime",realtimeApiHostV2:"wss://monica.im/api/realtime_v2"})});var _=c(a()),r=require("electron");const D={callServiceMethod:!0,proxiedFuncCall:!
```

- 搜索项 `callServiceMethod`，字符位置 884。

```javascript
realtimeApiHostV2:"wss://monica.im/api/realtime_v2"})});var _=c(a()),r=require("electron");const D={callServiceMethod:!0,proxiedFuncCall:!0,serviceEvent:!0,webEvent:!0,runMonica:!0,command:!0,"i18n.getTranslations":!0};function o(e){if(!Object.hasOwn(D,e))throw new Error(`[preload] chan
```

- 搜索项 `Object.hasOwn`，字符位置 1021。

```javascript
!0,serviceEvent:!0,webEvent:!0,runMonica:!0,command:!0,"i18n.getTranslations":!0};function o(e){if(!Object.hasOwn(D,e))throw new Error(`[preload] channel not allowed: ${e}`)}const b={ipcRenderer:{send:(e,s)=>{o(e),r.ipcRenderer.send(e,s)},invoke:(e,s)=>(o(e),r.ipcRenderer.invoke(e,s
```

- 搜索项 `exposeInMainWorld`，字符位置 1451。

```javascript
tMaxListeners(e)},setAccessibility:()=>{r.ipcRenderer.send("onSetAccessibility")}}};r.contextBridge.exposeInMainWorld("_bridge",b);

```

- 搜索项 `onSetAccessibility`，字符位置 1411。

```javascript
))},setMaxListeners:e=>{r.ipcRenderer.setMaxListeners(e)},setAccessibility:()=>{r.ipcRenderer.send("onSetAccessibility")}}};r.contextBridge.exposeInMainWorld("_bridge",b);

```


### `dist/background.js`

SHA-256：`bf04350104f5b36134b34f8eae6664385cce24e4b1beb145ab24834dc673d1f5`

- 搜索项 `getMediaAccessStatus("screen")`，字符位置 14598964。

```javascript
turePermission(){if(process.platform!=="darwin")return!0;let{systemPreferences:e}=this.electron,t=e.getMediaAccessStatus("screen");return t==="granted"}};var WCa=l(c());var rt=new la(XP);dc.setService(rt);var tSa=l(c());var hxe=de.getStaticFile("osx-iconTemplate@2x.png"),D8=hxe;var rSa=l(c());var fx
```

- 搜索项 `globalShortcut.register`，字符位置 14343024。

```javascript
r=(o,s,d)=>{if(s){console.info(`register ${o} hotkey as`,this.normalizeHotkey(s));try{this.electron.globalShortcut.register(this.normalizeHotkey(s),()=>{console.info(`${o} hotkey triggered`),d?.()})}catch(p){console.error(p)}}};r("home",e,()=>this.parent.toggleVisibility("home",!0)),r("spotli
```

- 搜索项 `this.parent.captureScreen()`，字符位置 14343368。

```javascript
",!0)}),r("sidebar",i,()=>{this.parent.toggleVisibility("globalSidebar",!0)}),r("screenshot",n,()=>{this.parent.captureScreen()}),RCe&&t===this.defaultHotkeys.spotlight?this.ctx.enableWinKbHook():this.ctx.disableWinKbHook()}normalizeHotkey(e){return e}};var VCa=l(c());var oCa=l(c());var nPa=l(c()
```

- 搜索项 `https://api.monica.im`，字符位置 14549616。

```javascript
f.Sdk=h})(VP||={});var{ApiRequestError:jPa,ApiRequestAborted:UPa}=ze;var P8=de.host;de.isProd&&(P8="https://api.monica.im");var Pp=`${P8}/api`,WP={baseUrl:Pp,globalSetHeader(a){let e=gc();return{...a,...e}},globalErrorHandler:a=>{if(console.warn("ApiRequestError",a.code,`(${a.httpStatus}, $
```

## 解释边界

REA 的 preload AST 证据为 ev_2bb4f4f581551670c6116fda1af2ecdfd93a07e52591049ac1efaf8021ed60ac。只选择 dist/preload.js 解析；主进程代码仅作上述定点文本交叉核实。没有建立完整 IPC 配对、真实权限行为、云端模型、更新下载或性能结论。S3 region 是更新配置，不是模型数据处理地域。
