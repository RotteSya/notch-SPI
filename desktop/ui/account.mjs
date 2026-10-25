export function accountPresentation(state) {
  const plus = state.plus, billing = plus?.billing_status;
  const busy = Boolean(state.accountBusy || state.accountSync?.status === 'loading');
  const renewable = plus?.can_manage === true && !['canceled','incomplete_expired','checkout_expired'].includes(billing);
  return {busy, buy:!renewable, manage:renewable,
    canBuy:!busy && plus?.available === true && !renewable,
    cancel:plus?.can_manage === true && !plus.cancel_at_period_end && billing !== 'canceled',
    attention:['past_due','unpaid','incomplete'].includes(billing),
    external:state.settings.channel !== 'official',
    sources:state.account?.allowance_sources,
  };
}
export function accountHTML(state,{button,escape,check,t}) {
  const tr=(zh,ja,en)=>state.settings.language==='zh'?zh:state.settings.language==='ja'?ja:en;
  const p=accountPresentation(state), a=state.account, plus=state.plus, trial=a?.free_trial;
  const disabled=p.busy?'disabled':'';
  const sourceNames=[tr('免费额度','無料枠','Free allowance'),tr('Plus 今日','Plus 本日','Plus today'),tr('长期题包','購入パック','Lasting packs'),tr('其他余额','その他','Other credits')];
  const keys=['trial','plus','purchased','other'];
  const next=p.sources && (p.sources.trial>0?0:p.sources.plus>0?1:p.sources.other>0?3:p.sources.purchased>0 && state.settings.allowPurchasedCredits?2:-1);
  const heading=p.external?tr('当前使用自定义服务','外部サービスを利用中','Using your own service')
    :trial?.status==='eligible'?tr('3 天，体验 notchSPI。','3日間、notchSPI を体験。','3 days with notchSPI.')
    :!p.sources?tr('正在核对可用权益','利用枠を確認中','Checking your available access')
    :next>=0?tr('下一题使用：','次の回答：','Next answer uses: ')+sourceNames[next]
    :tr('当前额度已用完','利用枠を使い切りました','No questions available right now');
  const period=plus?.paid_until?new Date(plus.paid_until).toLocaleString(state.settings.language,{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"}):'—';
  const status=!plus?tr('订阅状态尚未获取','プラン情報は未取得です','Plan status not yet available')
    :p.attention?tr('付款需要处理 · 请更新支付方式','お支払い方法を確認してください','Payment needs attention · update your payment method')
    :plus.status==='active'?(plus.cancel_at_period_end?tr('已取消续费 · 可用至 ','自動更新停止 · 利用期限：','Renewal canceled · access until '):tr('预计续费日：','次回更新予定：','Expected renewal: '))+period
    :plus.status==='pending'?tr('等待付款确认','決済確認待ち','Awaiting payment confirmation')
    :plus.status==='expired'?tr('当前权益已到期','現在の利用期間は終了しました','Your paid period has ended'):tr('尚未开通 Plus','Plus 未登録','No active Plus plan');
  const payments=state.config?.payments, packs=payments?.packs??[];
  const price=plus?.price_cents!=null?new Intl.NumberFormat(state.settings.language,{style:'currency',currency:plus.currency??'CNY',maximumFractionDigits:0}).format(plus.price_cents/100):'¥69';
  const error=state.accountActionError||state.accountSync?.error||state.accountSync?.plusError;
  return `<div class="account-section-heading"><h2>${tr('你的体验','利用状況','Your access')}</h2>${button('refresh',tr('刷新','更新','Refresh'),disabled)}</div><div class="group account-overview"><h3>${escape(heading)}</h3><p class="muted">${p.external?tr('当前求解不消耗官方额度。Plus 的订阅与自动续费仍独立生效。','公式の枠は消費しません。Plus の契約・自動更新は継続します。','Answers do not use official credits. Your Plus subscription and renewal remain independent.'):trial?.status==='eligible'?tr('每天 400 次成功求解。领取后开始 72 小时计时，无需订阅，不会自动续费。','毎日400回。受け取った時点から72時間。自動更新なし。','400 solves daily for 72 hours from claiming. No subscription or automatic renewal.'):tr('每日额度：北京时间 00:00 重置，不累计。','毎日の枠は北京時間00:00にリセット。繰り越しなし。','Daily allowances reset at midnight Beijing time; no rollover.')}</p>${p.sources&&!p.external&&trial?.status!=='eligible'?`<div class="balance-sources">${keys.map((key,i)=>`<div><strong>${Number(p.sources[key]??0)}</strong><small>${sourceNames[i]}</small></div>`).join('')}</div>`:''}<div class="actions">${trial?.status==='eligible'&&!p.external?button('trial',tr('开始 3 天免费体验','3日間の無料体験を開始','Start 3-day free trial'),`class="primary" ${disabled}`):''}</div>${error?`<p role="alert" class="error-message">${escape(error)}</p>`:''}</div>
  <h2>${tr('订阅计划','プラン','Your plan')}</h2><div class="group subscription"><div class="row"><h3>notchSPI Plus</h3>${button('refresh',p.busy?t('accountLoading'):tr('刷新','更新','Refresh'),disabled)}</div><p>${escape(price)} ${tr('/ 月 · 每日 400 次成功求解','/ 月 · 毎日400回','/ month · 400 successful solves daily')}</p><p>${escape(status)}</p>${plus?.status==='active'?`<p>${tr('今日剩余','本日の残り','Remaining today')} ${Number(plus.daily_remaining??0)}/${Number(plus.daily_limit??400)}</p><progress class="plus-progress" max="${Number(plus.daily_limit??400)}" value="${Math.max(0,Number(plus.daily_remaining??0))}" aria-label="${tr('今日 Plus 剩余额度','本日の Plus 残り','Plus remaining today')}"></progress>`:''}<div class="actions">${p.buy?button('plusCheckout',plus?.status==='pending'?tr('继续原付款','決済を再開','Resume payment'):tr('订阅 Plus','Plus に登録','Subscribe to Plus'),`class="primary" ${p.canBuy?'':'disabled'}`):''}${p.manage?button('plusPortal',p.attention?tr('更新支付方式','支払方法を更新','Update payment method'):t('manageBilling'),disabled):''}${p.cancel?button('plusCancel',t('cancelRenewal'),disabled):''}</div><p class="muted plan-terms">${tr('按月自动续费，可随时取消，已付款周期内仍可使用。每日额度于北京时间 00:00 重置，不累计。失败不扣次。','月ごとに自動更新。いつでも解約でき、支払済み期間は利用可能。毎日の枠は北京時間00:00にリセット。失敗は消費しません。','Renews monthly. Cancel any time; access remains through the paid period. Daily allowances reset at midnight Beijing time without rollover. Failures do not count.')}</p></div>
  <h2>${tr('额外用量','追加利用','Extra usage')}</h2><div class="group"><p>${tr('按需补充 · 余额长期有效 · 不自动续费','必要な分だけ · 有効期限なし · 自動更新なし','Top up as needed · no expiry · no automatic renewal')}</p><div class="pack-choice"><select id="purchase-pack" aria-label="${tr('一次性题包','購入パック','One-time pack')}" ${p.busy||!packs.length?'disabled':''}>${packs.map(pack=>`<option value="${escape(pack.id)}">${pack.questions} · ${escape(new Intl.NumberFormat(state.settings.language,{style:'currency',currency:payments.currency}).format(pack.amount_minor/(payments.currency==='JPY'?1:100)))}</option>`).join('')}</select>${button('purchaseSelected',tr('购买所选题包','選択したパックを購入','Buy selected pack'),p.busy||!packs.length?'disabled':'')}</div>${check('allowPurchasedCredits')}<p class="muted">${tr('使用顺序：免费额度 → Plus → 其他余额 → 已购题包。只有成功获得可用答案才计次；解释和失败不额外扣次。题包不自动续费，长期有效。','無料枠 → Plus → その他 → 購入パック。回答成功時のみ消費。解説・失敗は追加消費なし。','Order: free allowance → Plus → other credits → purchased packs. Only usable answers count; explanations and failures cost no extra.')}</p></div>
  <h2>${tr('账户与恢复','アカウントと復元','Account & recovery')}</h2><div class="group"><div class="actions">${state.hasAccountCredential?button('recoveryCode',tr('保存账户恢复码','復元コードを保存','Save recovery code'),disabled):''}${button('openRestore',tr('恢复已有账户','アカウントを復元','Restore existing account'),disabled)}</div><p class="muted">${tr('恢复码可在重装或换电脑时找回同一账户，不会合并两个账户的余额。请像密码一样保管，不要发给他人。','復元コードで同じアカウントを復元できます。残高は統合されません。他人に渡さないでください。','A recovery code restores the same account after reinstalling or changing computers. Balances are not merged. Keep it private, like a password.')}</p></div>`;
}
