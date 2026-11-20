// One prospective item per drawer. Sweep/scroll does no Shell work; a real right
// press can start preparation immediately. take() transfers a single-use ticket.
export class DrawerIntent {
  private item?:{id:string;ticket?:string};
  private timer?:ReturnType<typeof setTimeout>;
  private lastStart=-Infinity;
  constructor(private prepare:(id:string,ticket:string)=>Promise<void>,private discard:(ticket:string)=>Promise<void>) {}
  aim(id:string,press=false) {
    if(this.item?.id!==id){this.clear();this.item={id};}
    const item=this.item;
    if(item.ticket)return;
    const start=()=>{
      clearTimeout(this.timer);this.timer=undefined;
      if(this.item!==item)return;
      const ticket=item.ticket=crypto.randomUUID();this.lastStart=performance.now();
      void this.prepare(id,ticket).catch(()=>{});
    };
    if(press)start();else if(!this.timer)this.timer=setTimeout(start,Math.max(240,750-(performance.now()-this.lastStart)));
  }
  take(id:string) {
    if(this.item?.id!==id){this.clear();return;}
    const ticket=this.item.ticket;this.item=undefined;clearTimeout(this.timer);this.timer=undefined;return ticket;
  }
  clear(id?:string) {
    if(id && this.item?.id!==id)return;
    clearTimeout(this.timer);this.timer=undefined;const ticket=this.item?.ticket;this.item=undefined;
    if(ticket)void this.discard(ticket).catch(()=>{});
  }
}
