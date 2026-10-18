import {newPlus,mergePlus,reusablePlus,type PlusRecord,type PlusStore,type PlusUpdate} from './plus.ts';
export class MemoryPlus implements PlusStore {
  readonly records = new Map<number,PlusRecord>();
  private invoices = new Map<string,number>();
  private lookup: (token:string)=>number|null;
  private readUsage: (token:string,source:string)=>{remaining:number;held:number;granted:number}|null;
  constructor(lookup:(token:string)=>number|null, readUsage:MemoryPlus['readUsage']) { this.lookup=lookup; this.readUsage=readUsage; }
  async get(token:string) { return this.records.get(this.lookup(token)??-1)??null; }
  async byIntent(id:string) { return [...this.records.values()].find(r=>r.intentId===id)??null; }
  async reserve(token:string) {
    const device=this.lookup(token); if(device===null)return null;
    const old=this.records.get(device); if(old&&reusablePlus(old))return {...old};
    const r=newPlus(device); this.records.set(device,r); return {...r};
  }
  async attach(id:string,checkoutId:string,url:string) {
    const r=await this.byIntent(id); if(!r||(r.checkoutId&&r.checkoutId!==checkoutId))return false;
    r.checkoutId=checkoutId;r.checkoutURL=url;return true;
  }
  async beginSync(id:string) { const r=await this.byIntent(id); if(!r)return null; r.generation++;return {...r}; }
  async apply(id:string,generation:number,update:PlusUpdate) {
    const r=await this.byIntent(id);if(!r||r.generation!==generation)return false;
    const next=mergePlus(r,update);
    if(update.invoiceId) { const owner=this.invoices.get(update.invoiceId);if(owner!==undefined&&owner!==r.deviceId)throw new Error('Invoice binding mismatch');this.invoices.set(update.invoiceId,r.deviceId); }
    this.records.set(r.deviceId,next);return true;
  }
  async expireCheckout(id:string) { const r=await this.byIntent(id);if(r&&!r.subscriptionId)r.status='checkout_expired'; }
  async usage(token:string,source:string) { return this.readUsage(token,source); }
}
