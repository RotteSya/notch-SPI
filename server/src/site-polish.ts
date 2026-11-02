import {comparisonWallpaper} from './site-native-captures.ts';

// Final presentation layer: one device geometry and one spacing scale across breakpoints.
export const polishCSS = `
:root{--paper:#fcfcfa;--ink:#171b22;--muted:#657184;--accent:#397be5;--ease:cubic-bezier(.2,.75,.25,1)}
body,.continuation{background:var(--paper);color:var(--ink)}
.header.wrap,.continuation .wrap{width:min(1160px,calc(100% - 96px))}
.theater{background:#0a111c}.header.wrap{height:80px}.brand{font-size:18px;letter-spacing:-.02em}.brand .ghost-mark{width:38px;height:38px}.header .brand{margin:0;gap:8px}.mainnav{font-size:13px;gap:28px}.languages{font-size:12px}.header .button.small{height:38px;min-width:134px;border-radius:10px;font-size:12px}
.button{border-radius:11px;background:#91baff;border-color:#abcaff;box-shadow:inset 0 1px 0 #ffffff45,0 2px 3px #0000000d;transition:background .18s ease,box-shadow .18s ease,transform .18s ease}
.button:hover{background:#accbff;transform:translateY(-1px);box-shadow:inset 0 1px 0 #ffffff65,0 5px 16px #162d4b15}.button:active{transform:translateY(1px)}
.hero-band{position:relative;background:linear-gradient(180deg,#0a111c 0%,#101e33e8 38%,#2b426b96 60%,#fcfcfa 88%,#fcfcfa 100%),url('${comparisonWallpaper}') center 44%/cover;color:#f8faff}
.hero-band>.wrap{width:100%;max-width:none}.hero{padding:42px 0 0}.hero-copy{padding:0 24px}.hero h1{font-size:clamp(38px,4.2vw,60px);line-height:1.18;font-weight:650;letter-spacing:-.045em}.hero h1 span{color:#93bdff}.hero .sub{font-size:18px;font-weight:400;line-height:1.7;max-width:850px;margin-top:18px;color:#c1cbdb}.hero-actions{margin-top:24px;gap:12px}.hero-actions .button{height:52px;min-height:52px;min-width:210px;font-size:15px;border-radius:11px}.hero-actions .secondary{border-color:#8a9bb75c;background:#f1f5ff08;box-shadow:inset 0 1px 0 #ffffff12}.trial-line{font-size:12px;color:#b9c5d8;margin-top:16px;letter-spacing:.02em}
.hero .demo{width:min(1180px,calc(100% - 80px));margin:36px auto 0;padding-bottom:68px;position:relative}
.desktop{mask-image:linear-gradient(#000 0%,#000 84%,transparent 100%);height:450px;border:10px solid #070b11;border-bottom:0;border-radius:28px 28px 0 0;background:#24364d url('${comparisonWallpaper}') center top/cover;box-shadow:0 0 0 1px #c2d3f47a,0 0 0 3px #34445c,0 -12px 60px #9ebbe51a;overflow:hidden}
.menu-bar{visibility:visible;position:absolute;top:0;left:0;width:100%;height:25px;padding:0 18px;line-height:1;font-size:9px;color:#f3f6fb;z-index:1}.finder-menu,.system-menu{gap:12px}.menu-bar .mac-symbol{width:12px;height:12px}.menu-ghost{width:13px;height:13px}.system-menu{gap:12px}
.notch,.demo:has(#demo-question:checked) .notch,.demo:has(#demo-capture:checked) .notch{top:-1px;max-width:none;border:0;border-radius:0 0 19px 19px;background:#08090a;box-shadow:0 14px 28px #02071450;transition:width .44s var(--ease),height .44s var(--ease);padding:16px 22px}
.notch{width:420px;height:184px}.demo:has(#demo-question:checked) .notch{width:280px;height:84px}.demo:has(#demo-capture:checked) .notch{width:330px;height:118px}.notch-head{font-size:10px}.notch-status{font-size:9px}.notch-head .ghost-mark{width:15px;height:15px}.ready-instruction{display:block;font-size:11px;margin-top:14px;line-height:1.5}.demo:not(:has(#demo-question:checked)) .ready-instruction{display:none}.pending{margin-top:17px}.native-header-strip{height:33px}.native-shot{height:160px}.native-shot:after{height:44px}.native-shot>img{width:568px;left:-27px}.native-answer p{font-size:14px;line-height:24px}.native-answer{border-radius:0 0 19px 19px}.demo:has(#demo-answer:checked) .native-answer{animation:answer-settle .32s ease-out}
.question-window{top:155px;left:12%;width:76%;min-height:330px;background:#fcfcfd;border:1px solid #ffffffad;border-radius:12px 12px 0 0;box-shadow:0 18px 50px #050d2b30}.window-chrome{height:42px;padding:0 18px}.window-tools{gap:17px}.window-tools .mac-symbol{width:15px;height:15px}.traffic-lights i{width:10px;height:10px}.question-content{max-width:650px;padding:16px 36px 30px}.question-content h3{font-size:18px;line-height:1.65;max-width:460px;font-weight:500}.numbered-question{gap:20px}.numbered-question>span{font-size:16px}.options{font-size:16px;gap:4px;margin:12px 0 0 30px;max-width:350px}.options span{padding:1px 10px}.demo:has(#demo-answer:checked) .options span:nth-child(2){background:#e9f0ff}
.demo:after{display:none;content:'';position:absolute;bottom:67px;left:-5px;right:-5px;height:74px;pointer-events:none;background:linear-gradient(transparent,var(--paper));z-index:5}
.stage-controls{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);opacity:1;pointer-events:auto;background:#eef1f5;border:1px solid #e0e5ec;backdrop-filter:none;box-shadow:0 1px 1px #fff inset;border-radius:30px;padding:4px;gap:2px}.stage-controls label{min-height:32px;padding:6px 17px;font-size:11px;color:#6a7687;white-space:nowrap;gap:6px;transition:background .18s,color .18s}.stage-controls label:has(input:checked){background:#fff;color:#263b59;box-shadow:0 1px 4px #243b5b14}.stage-controls b{font-size:9px;opacity:.65}
.demo-playback{position:absolute;right:0;bottom:15px;opacity:1;pointer-events:auto;margin:0;min-height:32px}.demo-toggle{min-height:32px;font-size:11px;color:#62728a;border-color:#cad3e1;background:transparent;backdrop-filter:none;padding:5px 12px}.demo-toggle:hover{background:#e7edf6}.demo-note{position:absolute;left:0;right:auto;bottom:21px;font-size:10px;color:#7a8798;text-shadow:none;opacity:1;max-width:250px;margin:0}
.flying-capture{box-shadow:0 12px 30px #05112736;border:1px solid #c8d4e6;border-radius:8px;left:60%;top:58%;width:170px;will-change:auto}.demo:has(#demo-capture:checked) .flying-capture{will-change:transform,opacity}.demo:has(#demo-capture:checked) .question-window,.demo:has(#demo-capture:checked) .notch{animation:none}
@keyframes answer-settle{from{opacity:.2;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.protection{padding:50px 0 0}.protection>h2{font-size:44px;letter-spacing:-.035em;font-weight:650;margin-bottom:22px}.protection-tabs{max-width:600px;margin-bottom:28px;border-bottom:1px solid #dce2ea}.protection-tabs button{font-size:16px;font-weight:500;padding:13px 12px;border-bottom-width:2px;transition:color .18s,background .18s}.protection-tabs button:hover{background:#eaf1fb6b}.protection-tabs button[aria-selected=true]{color:var(--accent);border-color:var(--accent)}.protection-copy{min-height:100px}.protection-copy h3{font-size:32px;line-height:1.35;font-weight:600;letter-spacing:-.03em;margin-bottom:9px}.protection-copy h3 span{color:var(--accent)}.protection-copy p{font-size:16px;line-height:1.65;max-width:830px;color:#69758a}.protection-copy:not([hidden]){animation:copy-settle .24s ease-out}
@keyframes copy-settle{from{opacity:.5;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.comparison-devices{margin:18px -14px 0;gap:22px}.comparison-devices figcaption{font-size:12px;padding:5px 18px;margin-bottom:13px;font-weight:550;background:#edf0f4;color:#4f6078}.comparison-devices .local-label{background:#e5efff;color:#316cc1}
.comparison-laptop{aspect-ratio:1.72;margin:0 10px 12px;border:7px solid #090c12;border-bottom-width:12px;border-radius:17px 17px 6px 6px;background:#0b111c;box-shadow:0 0 0 1px #99a8bd,0 8px 24px #1a2e4b0c}
.comparison-laptop:after{content:'';position:absolute;left:-5%;right:-5%;bottom:-18px;height:9px;border-radius:1px 1px 50% 50%/1px 1px 8px 8px;background:linear-gradient(#e2e6ec,#a9b1bd 40%,#dce0e7 48%,#737d8e);box-shadow:0 2px 3px #17294620;z-index:3}
.comparison-screen{inset:0;border-radius:10px 10px 0 0}.comparison-wallpaper{object-position:center top}.comparison-question{left:10%;width:80%;top:30%;border-radius:6px}.comparison-answer{top:0;left:25%;width:50%;height:34%;border-radius:0 0 10px 10px;box-shadow:0 7px 14px #0003}.comparison-answer>img{width:110.28%;margin-left:-5.14%;clip-path:inset(0 0 16% 0)}.comparison-answer p{font-size:10px;line-height:1.6;padding:1px 10px}
.comparison-playback{max-width:730px;margin-top:24px;gap:12px}.comparison-toggle img{width:28px;height:28px}.comparison-progress{height:24px;appearance:none;background:transparent}.comparison-progress::-webkit-slider-runnable-track{height:3px;background:#d3deed;border-radius:3px}.comparison-progress::-webkit-slider-thumb{appearance:none;width:12px;height:12px;background:#4b8aeb;border:2px solid #fcfcfa;border-radius:50%;margin-top:-4.5px;box-shadow:0 0 0 1px #4b8aeb}.comparison-progress:focus-visible{outline:2px solid #4b8aeb;outline-offset:3px;border-radius:4px}.comparison-playback>span{font-size:12px}.protection-note{font-size:12px;color:#7c8898!important;margin-top:8px}
.continuation-features{grid-template-columns:1fr 1fr;padding:80px 0 64px;gap:38px}.continuation-features article:first-child{padding-right:0}.continuation-features article+article{padding-left:38px}.continuation-features h2{font-size:30px;line-height:1.35;font-weight:650;letter-spacing:-.035em;min-height:41px;margin-bottom:10px}.continuation-features p{font-size:15px;line-height:1.7;color:#69758a}.continuation-features figure{height:320px;margin:22px 0 0}.feature-caption{font-size:10px;color:#7a8796;margin-top:12px;text-align:left}.native-product-image{border-radius:9px;transition:filter .2s,transform .2s var(--ease)}.comparison-question:hover{transform:none}
@keyframes viewer-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.continuation .pricing-header h2{font-size:36px;font-weight:650;line-height:1.3;margin-bottom:26px}.concept-plans{gap:20px}.concept-plan{padding:25px 24px 22px;border-radius:14px;background:#fff;border-color:#dfe5ed;box-shadow:none}.concept-plan h3{font-size:22px;margin-bottom:10px}.concept-plan>p{font-size:14px;min-height:24px;margin-bottom:16px}.concept-plan .price-line{font-size:17px;margin-bottom:10px;min-height:49px;display:flex;align-items:baseline;gap:5px}.concept-plan .price-line .price{font-size:42px;font-weight:650;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.concept-plan ul{gap:8px;margin:10px 0 24px}.concept-plan li{font-size:14px;line-height:1.6;gap:9px}.plan-check{width:16px;height:20px}.concept-plan .button{font-size:14px;min-height:44px;border-radius:9px;background:#e9f1ff;border-color:#dce8fc;color:#235390;box-shadow:none}.concept-plan.trial-plan .button{background:#e9f1ff}.concept-plan.plus-plan{background:linear-gradient(150deg,#f5f9ff,#edf4ff);border-color:#84adeb;box-shadow:0 0 0 1px #fff inset}.plus-plan .button{background:#7daef8;color:#0c2c58;border-color:#7daef8}.plan-badge{font-size:11px;padding:4px 10px;top:23px;right:20px;background:#e0ecff;color:#3970bd}.pack-choices{gap:7px;margin:6px 0 8px}.pack-choice{padding:6px 0;font-size:14px;gap:9px;grid-template-columns:18px 1fr auto}.pack-choice strong{font-size:14px;font-weight:600}.pack-choice input{width:17px;height:17px}.pack-plan .pack-once{font-size:14px;margin:12px 0 20px}.pricing-details{font-size:12px;margin-top:16px}.pricing-details>summary{padding:8px 0}.pricing-details p{font-size:13px;max-width:900px;line-height:1.8}
.continuation .faq-section{padding-top:72px;padding-bottom:50px;gap:58px}.continuation .faq-section h2{font-size:32px;font-weight:650;line-height:1.35}.faq-lead{font-size:15px;line-height:1.8}.continuation .faq{border-color:#e1e5ec;border-radius:12px;overflow:hidden;background:#ffffff60}.continuation .faq summary{font-size:14px;font-weight:550;padding:16px 20px;line-height:1.5}.continuation .faq summary:hover{background:#f0f4fa}.continuation .faq details p{font-size:13px;line-height:1.8;padding:0 20px 18px;color:#68768a}.continuation .faq details{border-color:#e4e8ee}.scenic-footer{padding-top:100px}.scenic-footer .closing h2{font-size:38px;font-weight:650;letter-spacing:-.035em}.scenic-footer .closing .button{min-height:46px;font-size:14px}.footer-platforms{font-size:12px}.scenic-footer .footer{font-size:11px}.footer-meta nav{gap:20px}
@media(max-width:1100px){.header.wrap,.continuation .wrap{width:calc(100% - 64px)}.hero h1{font-size:46px}.hero h1 br{display:none}.hero .sub{font-size:16px}.hero .demo{width:calc(100% - 48px)}.desktop{height:430px}.menu-bar{padding:0 12px;font-size:8px}.finder-menu{gap:8px}.system-menu{gap:8px}.continuation-features{gap:26px}.continuation-features article+article{padding-left:26px}.continuation-features h2{font-size:26px;min-height:70px}.continuation-features figure{height:265px}.concept-plan{padding:22px 18px}.concept-plan li{font-size:12px}.concept-plan>p{min-height:42px;font-size:13px}.concept-plan .button{font-size:12px}.concept-plan .price-line{font-size:14px}.concept-plan .price-line .price{font-size:36px}.pack-choice,.pack-choice strong{font-size:12px}.plan-badge{right:12px;font-size:10px}.comparison-answer p{font-size:8px}.protection-copy{min-height:120px}}
@media(max-width:700px){.header.wrap,.continuation .wrap{width:calc(100% - 40px)}.header.wrap{height:auto;min-height:86px;padding-top:14px;padding-bottom:12px;row-gap:6px}.header .brand{font-size:15px}.brand .ghost-mark{width:29px;height:29px}.mainnav{font-size:11px;gap:20px}.languages{font-size:10px}.hero{padding-top:28px}.hero-copy{padding:0 22px}.hero h1{font-size:clamp(29px,7.7vw,42px);letter-spacing:-.04em;line-height:1.25}.hero h1 br{display:block}.hero .sub{font-size:13px;line-height:1.8;max-width:360px;margin-top:17px}.hero-actions{margin-top:22px;gap:9px}.hero-actions .button{min-width:0;min-height:46px;height:46px;font-size:12px;padding:10px 15px}.trial-line{font-size:10px;margin-top:15px}.hero .demo{width:calc(100% - 24px);margin-top:28px;padding-bottom:99px}.desktop{height:390px;border-width:6px;border-bottom:0;border-radius:17px 17px 0 0}.menu-bar{height:20px;font-size:7px;padding:0 9px}.finder-menu>span{display:none}.system-menu>span{display:none}.system-menu .mac-symbol{width:10px;height:10px}.menu-ghost{width:11px;height:11px}.notch{width:calc(100% - 40px);height:163px}.demo:has(#demo-question:checked) .notch{width:230px;height:78px}.demo:has(#demo-capture:checked) .notch{width:260px;height:109px}.notch,.demo:has(#demo-question:checked) .notch,.demo:has(#demo-capture:checked) .notch{top:-1px;padding:14px 18px;border-radius:0 0 15px 15px;max-width:360px}.notch-head{font-size:9px}.notch-status{font-size:8px}.ready-instruction{font-size:10px;margin-top:12px}.native-answer{border-radius:0 0 15px 15px}.native-header-strip{height:28px}.native-shot{height:139px}.native-shot:after{height:38px}.native-shot>img{width:493px;left:-24px}.native-answer p{font-size:12px;line-height:24px;padding:0 16px}.question-window{top:147px;left:4%;width:92%;min-height:300px;border-radius:8px 8px 0 0}.window-chrome{height:33px;padding:0 12px}.traffic-lights i{width:7px;height:7px}.window-tools{gap:10px}.window-tools .mac-symbol{width:11px;height:11px}.question-content{padding:15px 17px 25px}.numbered-question{gap:10px}.numbered-question>span{font-size:12px}.question-content h3{font-size:13px;line-height:1.65}.options{font-size:12px;gap:4px;margin-left:14px;margin-top:10px}.demo:after{bottom:98px;height:45px}.stage-controls{bottom:50px;max-width:100%;padding:3px;gap:0}.stage-controls label{font-size:10px;padding:6px 12px;min-height:30px}.stage-controls b{display:none}.demo-note{left:5px;bottom:22px;max-width:200px;font-size:9px}.demo-playback{bottom:13px;right:4px}.demo-toggle{font-size:10px;min-height:30px}.flying-capture{left:55%;width:130px;top:58%}
.protection{padding-top:24px}.protection>h2{font-size:31px;margin-bottom:16px}.protection-tabs{margin-bottom:22px}.protection-tabs button{font-size:12px;padding:12px 4px}.protection-copy{min-height:138px}.protection-copy h3{font-size:25px;line-height:1.4}.protection-copy h3 span{display:block}.protection-copy p{font-size:12px;line-height:1.8;margin-top:10px}.comparison-devices{margin:0 -7px;gap:9px}.comparison-devices figcaption{font-size:9px;padding:4px 9px;margin-bottom:10px}.comparison-laptop{margin:0 3px 9px;border-width:4px;border-bottom-width:6px;border-radius:9px 9px 3px 3px;aspect-ratio:1.5}.comparison-laptop:after{height:5px;bottom:-9px}.comparison-screen{border-radius:5px 5px 0 0}.comparison-question{left:7%;width:86%;top:34%;border-radius:2px}.comparison-answer{left:19%;width:62%;height:36%;border-radius:0 0 4px 4px}.comparison-answer p{font-size:4px;padding:0 4px}.comparison-playback{margin-top:20px;gap:9px}.comparison-toggle img{width:25px;height:25px}.comparison-playback>span{font-size:10px}.protection-note{font-size:10px;line-height:1.8;margin-top:8px}.continuation-features{grid-template-columns:1fr;gap:34px;padding:48px 0}.continuation-features h2{font-size:26px;min-height:0;margin-bottom:9px}.continuation-features p{font-size:13px}.continuation-features article+article{padding:30px 0 0;border-left:0;border-top:1px solid #e1e5ec}.continuation-features figure{height:auto;aspect-ratio:2.5;margin:22px 0 0}.continuation-features article+article figure{aspect-ratio:1.356}.feature-caption{font-size:9px;margin-top:12px}.continuation .pricing-header h2{font-size:28px;margin-bottom:20px}.concept-plans{grid-template-columns:1fr;gap:14px}.concept-plan{padding:24px}.concept-plan h3{font-size:23px}.concept-plan>p{min-height:0;font-size:14px}.concept-plan li{font-size:14px}.concept-plan .button{font-size:14px}.concept-plan .price-line{font-size:16px}.concept-plan .price-line .price{font-size:40px}.pack-choice,.pack-choice strong{font-size:14px}.plan-badge{right:24px;font-size:11px}.continuation .faq-section{padding-top:46px;padding-bottom:20px;gap:22px}.continuation .faq-section h2{font-size:28px}.faq-lead{font-size:13px}.continuation .faq summary{font-size:13px;padding:15px}.continuation .faq details p{font-size:12px;padding:0 15px 16px}.scenic-footer{padding-top:100px}.scenic-footer .closing h2{font-size:29px}.footer-platforms{font-size:10px}.footer-meta nav{gap:16px}.scenic-footer .footer{font-size:10px}}
/* Preserve the native panel as one proportional image; never rescale its toolbar separately. */
.demo:has(#demo-answer:checked) .notch{--panel-width:min(420px,calc(100vw - 76px));width:var(--panel-width);height:calc(var(--panel-width) * .3082191781 + 24px)}
.native-shot{width:100%;height:auto;aspect-ratio:1168/360;border-radius:0 0 19px 19px;overflow:hidden;background:#08090a}
.native-shot:after{display:none}
.native-shot>img{width:110.2739726%;left:-5.1369863%;top:0;height:auto;max-width:none}
.native-answer p{margin:0;font-size:12px;line-height:24px;padding:0 18px}
/* One aligned scene; the divider reveals only the local answer layer. */
.capture-heading{display:flex;justify-content:center;align-items:baseline;flex-wrap:wrap;margin:25px 0 12px;font-size:34px;line-height:1.4;font-weight:600;letter-spacing:-.025em}.capture-result{color:#397be5;white-space:nowrap}.capture-words{display:inline-grid;vertical-align:baseline;text-align:center}.capture-words>span{grid-area:1/1;opacity:0;transform:translateY(7px);transition:opacity .28s ease,transform .28s ease;pointer-events:none}.capture-words>span.is-current{opacity:1;transform:none}.capture-description{font-size:16px;line-height:1.7;max-width:760px;margin:0 auto;color:#69758a}.compare-labels{display:flex;justify-content:space-between;max-width:960px;margin:30px auto 12px;padding:0 10px;color:#66768b;font-size:12px}.compare-labels>span:first-child{color:#397be5}.reveal-device{width:min(960px,100%);margin:0 auto 20px;aspect-ratio:1.9;isolation:isolate}.reveal-local{position:absolute;inset:0;overflow:hidden;border-radius:10px 10px 0 0;clip-path:inset(0 calc(100% - var(--split)) 0 0);pointer-events:none}.reveal-device .comparison-answer{left:29%;width:42%;height:auto;aspect-ratio:1168/425;border-radius:0 0 12px 12px;opacity:1}.reveal-device .comparison-answer>img{clip-path:inset(0 0 15% 0)}.reveal-device .comparison-answer p{font-size:12px;line-height:22px;padding:0 14px}.reveal-device .comparison-question{top:29%;left:12%;width:76%}.reveal-divider{position:absolute;top:0;bottom:0;left:var(--split);width:2px;transform:translateX(-50%);background:#f8fbff;box-shadow:0 0 0 1px #243d6030;pointer-events:none;z-index:4}.reveal-divider>span{position:absolute;top:58%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border:1px solid #d7e2f0;border-radius:50%;background:#fff;box-shadow:0 3px 14px #172d4a30;display:flex;align-items:center;justify-content:center;gap:5px;color:#4974ac;font-size:22px}.reveal-divider i{height:14px;border-left:1px solid #c6d4e7}.reveal-range{position:absolute;z-index:5;left:-22px;top:0;width:calc(100% + 44px);height:100%;margin:0;opacity:0;cursor:ew-resize;appearance:none;background:transparent;touch-action:pan-y}.reveal-range::-webkit-slider-thumb{appearance:none;width:44px;height:44px}.reveal-range::-moz-range-thumb{width:44px;height:44px;border:0}.reveal-device:has(.reveal-range:focus-visible){outline:3px solid #478aff;outline-offset:6px}.compare-help{font-size:13px;margin:26px 0 7px;color:#64758e}.compare-help>span{display:inline-block;margin-left:16px;font-size:11px;color:#8793a4}.reduced-words .capture-words>span{transition:none}.reduced-words .capture-words>span:not(:first-child){visibility:hidden}.reduced-words .capture-words>span:first-child{opacity:1;transform:none}
.reveal-device .comparison-question{background:#fcfcfd;box-shadow:0 12px 30px #06112526;min-height:80%;color:#20232a;container-type:inline-size}.comparison-question .window-chrome{height:34px;padding:0 16px;display:flex;justify-content:space-between;color:#8d939e}.comparison-question-content{padding:16px 12% 28px;text-align:left}.comparison-question-content h4{font-size:clamp(10px,2.7cqw,19px);line-height:1.65;font-weight:500;margin:0}.comparison-question-content .numbered-question{gap:16px}.comparison-question-content .numbered-question>span{font-size:clamp(10px,2.5cqw,17px)}.comparison-question-content .options{font-size:clamp(9px,2.5cqw,17px);margin:12px 0 0 25px;gap:4px}.comparison-question-content .options span{padding:1px 0}

@media(max-width:700px){.capture-heading{margin:20px 0 12px;font-size:25px}.capture-heading>span:first-child{width:100%}.comparison-question .window-chrome{height:22px;padding:0 9px}.comparison-question .traffic-lights i{width:6px;height:6px}.comparison-question-content{padding:8px 7% 20px}.comparison-question-content .numbered-question{gap:8px}.comparison-question-content .options{margin:6px 0 0 16px;gap:2px}.capture-description{font-size:12px;line-height:1.8}.compare-labels{margin-top:24px;font-size:10px;padding:0 2px}.reveal-device{aspect-ratio:1.5;margin-bottom:15px}.reveal-local{border-radius:5px 5px 0 0}.reveal-device .comparison-answer{left:23%;width:54%;border-radius:0 0 6px 6px;aspect-ratio:1168/450}.reveal-device .comparison-answer p{font-size:6px;line-height:11px;padding:0 7px}.reveal-device .comparison-question{left:5%;width:90%;top:34%}.reveal-divider>span{width:36px;height:36px;font-size:19px;gap:4px}.compare-help{font-size:11px;margin-top:21px;line-height:1.8}.compare-help>span{font-size:10px;margin-left:8px}}
/* Mid-page rhythm: natural image heights, then deliberate space for decisions. */
.continuation-features{padding:56px 0 0;gap:40px;align-items:start}
.continuation-features article+article{padding-left:40px}
.continuation-features h2{min-height:0;margin-bottom:8px}
.continuation-features figure,.continuation-features article+article figure{height:auto;aspect-ratio:auto;margin:20px 0 0;align-items:flex-start}
.continuation-features figure>.native-product-image{height:auto;width:100%}
.continuation-features figure img{height:auto;width:100%;object-fit:contain}
.continuation-features .feature-caption{margin-top:10px}
.continuation .pricing-band{padding-top:80px}
.continuation .pricing-header h2{margin-bottom:30px}
.concept-plan{padding:28px 24px 24px}
.concept-plan ul{gap:9px;margin-bottom:24px}
.continuation .faq-section{padding-top:96px;padding-bottom:80px;gap:64px;grid-template-columns:.85fr 1.15fr}
.continuation .faq-section h2{max-width:400px;margin-bottom:16px}
.continuation .faq summary{padding:20px 22px}
.continuation .faq details p{padding:0 22px 22px;line-height:1.9}
@media(min-width:701px) and (max-width:1100px){.continuation-features{gap:28px}.continuation-features article+article{padding-left:28px}.continuation-features h2{font-size:25px}.continuation .faq-section{gap:36px;grid-template-columns:.8fr 1.2fr}.concept-plans{gap:16px}.concept-plan{padding:24px 18px}}
@media(max-width:700px){.continuation-features{padding:36px 0 0;gap:28px}.continuation-features article+article{padding:28px 0 0}.continuation-features figure,.continuation-features article+article figure{margin-top:16px}.continuation .pricing-band{padding-top:60px}.continuation .pricing-header h2{margin-bottom:24px}.concept-plans{gap:20px}.concept-plan{padding:26px 24px}.continuation .faq-section{grid-template-columns:1fr;padding-top:64px;padding-bottom:52px;gap:28px}.continuation .faq summary{padding:18px 16px}.continuation .faq details p{padding:0 16px 20px}}
/* Favor readable history content; center the shorter capture in the shared image row. */
@media(min-width:901px){
.continuation-features{grid-template-columns:minmax(0,1.22fr) minmax(0,1fr);column-gap:48px;row-gap:0;grid-template-rows:auto auto auto auto;align-items:start}
.continuation-features article{display:grid;grid-template-rows:subgrid;grid-row:span 4;min-width:0}
.continuation-features article+article{padding-left:0;border-left:0}
.continuation-features h2{font-size:28px;line-height:1.35}
.continuation-features figure{margin-top:20px;align-self:center}
}
@media(min-width:901px) and (max-width:1100px){.continuation-features{column-gap:36px}.continuation-features h2{font-size:25px}}
@media(min-width:701px) and (max-width:900px){.continuation-features{grid-template-columns:1fr;gap:28px;max-width:680px;margin-inline:auto}.continuation-features article+article{padding:28px 0 0;border-left:0;border-top:1px solid #e1e5ec}.continuation-features h2{min-height:0}.continuation-features article+article figure{max-width:520px}}
/* Consistent optical rhythm, legibility and keyboard feedback. */
.reveal-range{left:0;width:100%}
.hero h1{ text-wrap:balance }
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #78a7ff;outline-offset:5px}
.button,.demo-toggle,.stage-controls label{transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease}
.demo-toggle{min-height:40px;padding-inline:16px}
.concept-plan{border-radius:20px;box-shadow:0 4px 20px #23355006}
.concept-plan .button{min-height:46px}
.continuation .faq summary{min-height:58px;align-content:center}
.continuation .faq details[open]{border-color:#c8d4e6;background:#fff}
@media(min-width:701px){.continuation-features{padding-top:80px}.continuation .pricing-band{padding-top:100px}}
@media(max-width:900px){
.trial-line{font-size:12px;line-height:1.7}.demo-note,.feature-caption{font-size:11px}
.capture-description{font-size:14px;max-width:520px}.protection-note{font-size:12px;line-height:1.8}
.continuation-features p{font-size:15px;line-height:1.8}
.continuation-features figure,.continuation-features article+article figure{max-width:560px;margin-inline:auto}
}
@media(max-width:700px){
.hero h1{font-size:clamp(34px,6.3vw,44px);line-height:1.22;letter-spacing:-.045em}
.hero-actions .button{font-size:13px;padding-inline:18px}
.stage-controls label{min-height:40px;display:flex;align-items:center;font-size:11px;padding-inline:12px}
.stage-controls{bottom:48px}.demo-note{bottom:17px;max-width:180px}.demo-playback{bottom:8px}
.continuation-features{padding-top:48px;gap:40px}.continuation-features article+article{padding-top:40px}
.continuation-features h2{font-size:27px;line-height:1.4;letter-spacing:-.035em;text-wrap:balance}
.continuation-features figure{margin-top:24px}.continuation .pricing-band{padding-top:76px}
.continuation .faq summary{font-size:15px;line-height:1.6}.continuation .faq details p{font-size:14px;line-height:1.85}
.faq-lead{font-size:15px}.compare-help{font-size:12px}
}

/* A complete device stage, followed by two editorial product stories. */
.hero-band{background:radial-gradient(ellipse at 50% 62%,#273e61 0%,#111e31 48%,#0a111c 80%);padding-bottom:38px}
.hero{padding-top:56px}.hero h1{max-width:1000px;margin-inline:auto;font-size:clamp(42px,4.5vw,64px)}
.hero .sub{max-width:680px;font-size:17px}.hero .demo{margin-top:48px;padding-bottom:76px}
.desktop{mask-image:none;height:476px;border-bottom:10px solid #070b11;border-radius:24px;box-shadow:0 0 0 1px #8a9ab34a,0 28px 65px #0005}
.question-window{top:178px;min-height:260px;border-radius:12px;width:72%;left:14%}
.question-content{padding-top:8px;padding-bottom:24px}.question-content h3{font-size:17px}.options{font-size:15px}
.stage-controls{background:#ffffff0a;border-color:#ffffff1c;box-shadow:inset 0 1px #ffffff0a;bottom:8px}
.stage-controls label{color:#afbbce;min-height:40px}.stage-controls label:has(input:checked){background:#dce8fc;color:#182e4e;box-shadow:0 2px 8px #0002}
.demo-note{color:#9eabc0;bottom:25px}.demo-toggle{color:#bfccdf;border-color:#ffffff30}.demo-toggle:hover{background:#ffffff15}
.demo-playback{bottom:13px}.protection{padding-top:90px}.protection>h2{font-size:42px}
.continuation-features{display:block;padding:100px 0 0;max-width:none}
.continuation-features article,.continuation-features article+article{display:grid;grid-template-columns:.8fr 1.2fr;grid-template-rows:auto auto 1fr;column-gap:64px;row-gap:12px;align-items:start;padding:56px 0;border:0;border-top:1px solid #dfe3e9}
.continuation-features article+article{grid-template-columns:1.2fr .8fr;margin-top:12px}
.continuation-features h2{grid-column:1;grid-row:1;margin:16px 0 0;max-width:340px;font-size:36px;line-height:1.35}
.continuation-features p{grid-column:1;grid-row:2;font-size:16px;max-width:350px}
.continuation-features figure,.continuation-features article+article figure{grid-column:2;grid-row:1/4;width:100%;max-width:none;align-self:center;margin:0;aspect-ratio:auto}
.continuation-features .feature-caption{grid-column:1;grid-row:3;margin-top:12px;font-size:11px}
.continuation-features article+article h2,.continuation-features article+article p,.continuation-features article+article .feature-caption{grid-column:2}
.continuation-features article+article figure{grid-column:1}
.continuation .pricing-band{padding-top:80px;border-top:1px solid #dfe3e9;margin-top:28px}
.continuation .pricing-header{text-align:center}.continuation .pricing-header h2{font-size:42px;margin-bottom:40px}
.concept-plan{padding:32px 28px;border-radius:18px}.concept-plan.plus-plan{background:#eaf2ff;border-color:#abc4e9;box-shadow:0 12px 32px #273c5810}
.pack-choice{padding:9px 8px;border-radius:8px;transition:background .16s}.pack-choice:has(input:checked){background:#edf3fc}.concept-plan .button{min-height:48px}
.continuation .faq-section{padding-top:110px;padding-bottom:110px}.scenic-footer{padding-top:110px}

@media(min-width:701px) and (max-width:1100px){.hero h1{max-width:700px;font-size:48px}.hero .sub{max-width:580px}.continuation-features article,.continuation-features article+article{column-gap:32px}.continuation-features h2{font-size:29px}.concept-plan{padding:26px 18px}.protection{padding-top:70px}}
@media(max-width:700px){
.hero-band{padding-bottom:24px}.hero{padding-top:34px}.hero h1{font-size:clamp(32px,8.2vw,44px)}.hero .sub{font-size:14px;max-width:360px}
.hero-actions{flex-direction:column;align-items:center;gap:8px}.hero-actions .button{width:min(280px,100%)}.hero-actions .secondary{min-height:38px;height:38px;border:0;background:transparent;box-shadow:none;font-size:12px}
.hero .demo{margin-top:32px;padding-bottom:110px;width:calc(100% - 28px)}
.desktop{height:410px;border:6px solid #070b11;border-radius:18px}.question-window{top:155px;left:4%;width:92%;min-height:232px;border-radius:8px}.question-content{padding:12px 14px 18px}.question-content h3{font-size:13px}.options{font-size:12px}
.stage-controls{bottom:56px}.demo-note{bottom:22px;left:2px;font-size:10px;max-width:160px}.demo-playback{bottom:12px;right:0}
.protection{padding-top:54px}.protection>h2{font-size:32px}.capture-heading{font-size:25px}
.continuation-features{padding-top:56px}
.continuation-features article,.continuation-features article+article{display:flex;flex-direction:column;gap:10px;padding:32px 0;margin:0}
.continuation-features h2{font-size:28px;margin:0;max-width:100%}.continuation-features p{font-size:15px}
.continuation-features figure,.continuation-features article+article figure{margin-top:18px;order:3;width:100%}.continuation-features .feature-caption{order:4;margin:0}
.continuation .pricing-band{padding-top:54px;margin-top:20px}.continuation .pricing-header h2{font-size:31px;text-align:left;margin-bottom:28px}
.concept-plan{padding:28px 24px}.continuation .faq-section{padding-top:64px;padding-bottom:64px}.scenic-footer{padding-top:74px}
}
@media(max-width:1100px){html[lang="ja"] .hero h1 span{display:block}html[lang="ja"] .hero h1{font-size:clamp(30px,5.7vw,44px)}}

/* Hero light study: paint only, with all existing geometry retained. */
.hero-band{background:radial-gradient(ellipse 48% 15% at 50% 43%,#b5cbf53b,transparent 78%),radial-gradient(ellipse 70% 42% at 50% 74%,#30456466,transparent 78%),linear-gradient(180deg,#0a111c 0%,#090c12 17%,#0b1019 42%,#101925 100%)}
.hero-band .demo:before{content:'';position:absolute;left:-8%;right:-8%;top:-46px;height:190px;pointer-events:none;background:radial-gradient(ellipse at 50% 42%,#cadbff26,transparent 68%);filter:blur(18px)}
.hero-band .desktop{border-color:#05070c;background-image:radial-gradient(ellipse at 24% 8%,#edf3ff16,transparent 55%),linear-gradient(110deg,#050b1808,transparent 44%,#04091624),url('${comparisonWallpaper}');box-shadow:0 0 0 1px #d0daf19c,0 0 0 2px #59657e,0 -1px 0 3px #a0b0d078,0 1px 0 3px #0b101a,0 -15px 55px #adcaff1c,0 30px 80px #0009,inset 0 1px 0 #e2eaff38}
.hero-band .desktop:after{content:'';position:absolute;inset:0;z-index:6;border-radius:inherit;pointer-events:none;background:linear-gradient(118deg,#f0f5ff06,transparent 35%,transparent 75%,#a5b9f005);box-shadow:inset 0 0 0 1px #f0f5ff20,inset 0 1px 14px #b5ccff0b}
.hero-band .notch{box-shadow:0 18px 32px #02050b70,0 3px 7px #0006}
.hero-band .question-window{background:#f8f9fc;box-shadow:0 18px 55px #020a203d,0 3px 12px #030a1926,inset 0 1px 0 #fff}
@media(max-width:700px){.hero-band .demo:before{left:-2%;right:-2%;top:-30px;height:110px;filter:blur(12px)}.hero-band .desktop{box-shadow:0 0 0 1px #c8d6ef94,0 0 0 2px #53627c,0 -1px 0 3px #8296ba66,0 -10px 34px #b1ccff1c,0 20px 48px #0008,inset 0 1px 0 #dce8ff30}}
/* Native screenshots are the complete panel; do not append simulated answer text. */
.demo:has(#demo-answer:checked) .notch{height:calc(var(--panel-width) * .3082191781)}
.reveal-device .comparison-answer{aspect-ratio:1168/360}
/* Only the current word contributes width, so its suffix follows naturally. */
.capture-words{display:inline-block;position:relative}
.capture-words>span{display:none;grid-area:auto}
.capture-words>span.is-current{display:inline-block}
.reduced-words .capture-words>span{display:none}
.reduced-words .capture-words>span:first-child{display:inline-block}
/* Interaction finishes: quiet at rest, explicit on focus, responsive on press. */
.capture-words.words-ready{clip-path:inset(-4px 0 -4px 0);transition:width .34s cubic-bezier(.22,.8,.25,1)}
.capture-words>span{white-space:nowrap}
.capture-words>span.is-current{animation:word-reveal .28s ease-out both}
@keyframes word-reveal{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.stage-controls label:has(input:focus-visible){outline:2px solid #a7c6ff;outline-offset:3px}
.stage-controls label{user-select:none;transition:color .18s ease,background-color .18s ease,box-shadow .18s ease}
.stage-controls label:active{box-shadow:inset 0 1px 5px #07132635}
.pack-choice:has(input:focus-visible){outline:2px solid #397be5;outline-offset:3px}
.reveal-divider>span{transition:box-shadow .2s ease,background-color .2s ease}
.reveal-device:has(.reveal-range:hover) .reveal-divider>span,.reveal-device:has(.reveal-range:focus-visible) .reveal-divider>span{background:#f4f8ff;box-shadow:0 0 0 5px #6e9fe51a,0 5px 18px #172d4a30}
.reveal-device:has(.reveal-range:active) .reveal-divider>span{box-shadow:0 0 0 8px #6e9fe51a,0 3px 12px #172d4a30}
.button[disabled],.button[disabled]:hover,.button[disabled]:active{transform:none;cursor:default;box-shadow:none}
.hero-actions .button[disabled],.hero-actions .button[disabled]:hover{background:#f1f5ff08;border-color:#8a9bb75c;color:#aeb9cd}
.continuation .faq summary:focus-visible{outline-offset:-4px;border-radius:8px}
.continuation .faq summary:active{background:#e9eff8}
.continuation .faq details[open] p{animation:faq-reveal .2s ease-out both}
@keyframes faq-reveal{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:translateY(0)}}
@media(hover:hover){.pack-choice:hover{background:#f1f5fc}.pack-choice:has(input:checked):hover{background:#e6effc}.concept-plan .button:hover{background:#d9e8ff;box-shadow:0 3px 12px #2f5c9810}.concept-plan.plus-plan .button:hover{background:#91b9f8}}
@supports(interpolate-size:allow-keywords){
.continuation .faq details{interpolate-size:allow-keywords}
.continuation .faq details::details-content{block-size:0;overflow:clip;transition:block-size .28s cubic-bezier(.22,.8,.25,1),content-visibility .28s allow-discrete}
.continuation .faq details[open]::details-content{block-size:auto}
}
@media(prefers-reduced-motion:reduce){.continuation .faq details::details-content{transition:none}}
/* Refine the existing surfaces without changing their geometry. */
.hero-band .desktop{box-shadow:0 0 0 1px #c5d3eb80,0 0 0 2px #59657e,0 -1px 0 3px #a0b0d05c,0 1px 0 3px #0b101a,0 -15px 55px #adcaff1c,0 30px 80px #0009,inset 0 1px 0 #e2eaff38}
.stage-controls{background:#ffffff08;border-color:#d5e1f020;box-shadow:inset 0 1px #fff0}
.stage-controls label:has(input:checked){background:#d4e1f3;color:#1d304b;box-shadow:0 1px 3px #0003,inset 0 1px #ffffff90}
.concept-plan{border-color:#dce3ec;box-shadow:0 2px 8px #1b304906,0 12px 30px #1b304904}
.concept-plan.plus-plan{border-color:#a3bfe3;box-shadow:inset 0 1px #ffffffbb,0 10px 28px #263e5c0c}
.continuation .faq{border-color:#dce3ec;box-shadow:0 2px 12px #1b304904}
@media(max-width:700px){.hero-band .desktop{box-shadow:0 0 0 1px #c8d6ef75,0 0 0 2px #53627c,0 -1px 0 3px #8296ba55,0 -10px 34px #b1ccff1c,0 20px 48px #0008,inset 0 1px 0 #dce8ff30}}
/* Chapter seams: shared atmosphere and quiet, once-only arrivals. */
.hero-band{padding-bottom:0;isolation:isolate}
.hero-band:before{content:'';position:absolute;inset:auto 0 0;height:340px;z-index:-1;background:linear-gradient(180deg,#fcfcfa00 44%,#e8f2f887 74%,var(--paper) 100%),radial-gradient(ellipse 42% 85% at 50% 6%,#101925 12%,#18304ae6 42%,#10192500 100%),radial-gradient(ellipse 90% 100% at 30% 100%,#e3edf4 0%,#78a8d299 48%,#10192500 100%);pointer-events:none}
.hero-band:after{content:'';display:block;height:144px;pointer-events:none}
.protection{padding-top:48px}
.continuation-features article,.continuation-features article+article{border-top:0;position:relative}
.continuation-features article:before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#d7dfe7 25%,#d7dfe7 75%,transparent);pointer-events:none}
.continuation .pricing-band{border-top:0;position:relative;background:radial-gradient(ellipse 65% 200px at 50% 0,#eaf0f670,transparent)}
.scenic-footer{position:relative}
.scenic-footer:before{content:'';position:absolute;inset:0 0 auto;height:110px;background:linear-gradient(180deg,var(--paper),#fcfcfaca 25%,#fcfcfa40 65%,transparent);pointer-events:none}
.scenic-footer .closing,.scenic-footer .footer{position:relative}
.chapter-arrival{transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1),filter .8s cubic-bezier(.16,1,.3,1)}
.chapter-arrival.is-waiting{opacity:0;transform:translateY(14px);filter:blur(5px)}
.chapter-arrival:focus-within{opacity:1;transform:none;filter:none}
@media(max-width:700px){.hero-band:before{height:230px}.hero-band:after{height:96px}.protection{padding-top:32px}.scenic-footer:before{height:80px}.chapter-arrival.is-waiting{transform:translateY(10px);filter:blur(3px)}}
@media(prefers-reduced-motion:reduce){.chapter-arrival,.chapter-arrival.is-waiting{opacity:1;transform:none;filter:none;transition:none}}
@media print{.chapter-arrival,.chapter-arrival.is-waiting{opacity:1;transform:none;filter:none;transition:none}}
.continuation-features #single-mode{grid-template-columns:.8fr 1.2fr}
.continuation-features #single-mode p strong{font-weight:500;color:var(--ink);display:inline-block;margin-bottom:8px}
.single-demo video{display:block;width:100%;height:auto;aspect-ratio:1920/1136;background:#101925;border-radius:12px;box-shadow:0 6px 24px #182c4612}
.single-demo video:focus-visible{outline:3px solid #78a9ef;outline-offset:5px}
@media(max-width:700px){.single-demo video{border-radius:8px}}
.continuation-features .auto-feature figure.auto-demo{display:block;grid-column:2}
.auto-demo video{aspect-ratio:3024/1784}
/* Automatic mode is explained as a workflow, not a simulated app panel. */
.continuation-features article.auto-feature{grid-template-columns:.8fr 1.2fr}
.continuation-features .auto-feature h2,.continuation-features .auto-feature p,.continuation-features .auto-feature>.feature-caption{grid-column:1}
.continuation-features .auto-feature p strong{font-weight:500;color:var(--ink);display:inline-block;margin-bottom:8px}
.continuation-features .auto-feature figure.auto-flow{display:block;grid-column:2;padding:32px 36px;background:linear-gradient(125deg,#edf3fb,#f6f8fb 75%);border-radius:18px}
.auto-flow ol{list-style:none;padding:0;margin:0;display:grid;gap:24px}
.auto-flow li{position:relative;display:flex;gap:20px;align-items:center;font-size:16px;font-weight:500;color:#263b59}
.auto-step{position:relative;display:grid;place-items:center;flex:none;width:64px;height:44px;border-radius:10px;background:#fff;box-shadow:0 2px 8px #29466b0b,inset 0 0 0 1px #d5dfec;color:#4d78ad;font-size:13px;font-weight:600;letter-spacing:.04em}
.auto-flow li:not(:last-child) .auto-step:after{content:'';position:absolute;top:100%;left:50%;height:24px;width:1px;background:linear-gradient(#b9cce3,#dce6f1)}
.auto-flow figcaption{font-size:12px;line-height:1.7;color:#69758a;margin-top:24px;padding-top:18px;border-top:1px solid #d7e2ef}
@media(min-width:701px) and (max-width:1100px){.continuation-features .auto-feature figure.auto-flow{padding:26px}.auto-flow li{font-size:14px;gap:14px}}
@media(max-width:700px){.continuation-features .auto-feature figure.auto-flow{padding:24px;border-radius:14px;margin-top:18px}.auto-flow li{font-size:14px;gap:16px}.auto-step{width:60px;height:42px}.auto-flow figcaption{font-size:11px}}
/* Motion follows the product story: lift, travel, receive, then read. */
.stage-controls.has-indicator{isolation:isolate}
.stage-controls.has-indicator:before{content:'';position:absolute;left:0;top:4px;width:var(--step-width);height:var(--step-height);transform:translateX(var(--step-x));border-radius:24px;background:#d4e1f3;box-shadow:0 1px 3px #0003,inset 0 1px #ffffff90;transition:transform .5s cubic-bezier(.22,1,.36,1),width .5s cubic-bezier(.22,1,.36,1),height .3s ease;pointer-events:none;z-index:-1}
.stage-controls.has-indicator label:has(input:checked){background:transparent;box-shadow:none}
.demo:has(#demo-capture:checked) .flying-capture{animation:fly-in 2.52s linear .48s both}
@keyframes fly-in{
0%{opacity:0;transform:translate(4px,16px) rotate(3deg) scale(.94);animation-timing-function:cubic-bezier(.16,1,.3,1)}
12%{opacity:1;transform:translate(0,0) rotate(-2deg) scale(1.025)}
28%{opacity:1;transform:translate(0,-4px) rotate(-2deg) scale(1.025);animation-timing-function:cubic-bezier(.4,0,.35,1)}
55%{opacity:1;transform:translate(calc(var(--flight-x,-230px)*.42),calc(var(--flight-y,-150px)*.76)) rotate(2deg) scale(.65);animation-timing-function:cubic-bezier(.16,1,.3,1)}
79%{opacity:.9;transform:translate(var(--flight-x,-230px),var(--flight-y,-150px)) rotate(0) scale(.18)}
86%,100%{opacity:0;transform:translate(var(--flight-x,-230px),var(--flight-y,-150px)) rotate(0) scale(.16)}}
.demo:has(#demo-capture:checked) .capture-thumb{animation:thumbnail-receive 3s linear both}
.demo[data-paused="true"] .capture-thumb{animation-play-state:paused}
@keyframes thumbnail-receive{0%,70%{opacity:0;transform:scale(.8)}80%{opacity:1;transform:scale(1.12);box-shadow:0 0 18px #a8caff90}92%,100%{opacity:1;transform:scale(1);box-shadow:0 0 0 #a8caff00}}
.demo:has(#demo-answer:checked) .native-answer{animation:answer-settle .52s cubic-bezier(.16,1,.3,1) both}
@keyframes answer-settle{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
/* Copy stays anchored; imagery and related objects arrive in a measured sequence. */
.chapter-arrival{transition:opacity .65s ease;transform:none;filter:none}
.chapter-arrival.is-waiting{transform:none;filter:none}
.chapter-arrival>:is(h2,h3,p,figure,.concept-plan){transition:opacity .65s ease,transform .85s cubic-bezier(.16,1,.3,1);transition-delay:0s}
.chapter-arrival>p{transition-delay:.06s}
.chapter-arrival>figure{transition-delay:.12s;transform-origin:50% 80%}
.chapter-arrival.is-waiting>:is(h2,h3,p){transform:translateY(10px)}
.chapter-arrival.is-waiting>figure{transform:translateY(26px) scale(.985)}
.concept-plans.chapter-arrival{opacity:1}
.concept-plans.chapter-arrival.is-waiting>.concept-plan{opacity:0;transform:translateY(20px)}
.concept-plans.chapter-arrival>.concept-plan:nth-child(2){transition-delay:.07s}
.concept-plans.chapter-arrival>.concept-plan:nth-child(3){transition-delay:.14s}
@media(hover:hover) and (pointer:fine){.button:not([disabled]):hover{transform:translateY(-2px);box-shadow:inset 0 1px #ffffff70,0 5px 16px #4f82c329}.button:not([disabled]):active{transform:translateY(0) scale(.98);transition-duration:.1s}}
@media(max-width:700px){.stage-controls.has-indicator:before{top:3px}.chapter-arrival.is-waiting>figure{transform:translateY(16px) scale(.99)}}
@media(prefers-reduced-motion:reduce){.chapter-arrival.is-waiting>:is(h2,h3,p,figure,.concept-plan){opacity:1;transform:none}.stage-controls.has-indicator:before{transition:none}}
@media print{.chapter-arrival.is-waiting>:is(h2,h3,p,figure,.concept-plan){opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}html{scroll-behavior:auto}.native-product-image:hover,.button:hover,.button:active{transform:none}.demo:has(#demo-capture:checked) .flying-capture{display:none}}
`;
