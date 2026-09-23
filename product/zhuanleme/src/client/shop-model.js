/** Shared, server-backed shop deletion state for sidebar and active workbench. */
export function createShopActions(api) {
    let state={deleted:[]},generation=0;
    const listeners=new Set();
    const request=async body=>{const version=++generation;const next=await api(body);if(version===generation){state=next;for(const fn of listeners)fn();}return next;};
    return {getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},load:()=>request({op:'shop-state'}),remove:id=>request({op:'shop-delete',shop:id}),restore:id=>request({op:'shop-restore',shop:id}),dispose(){generation++;listeners.clear();}};
}
