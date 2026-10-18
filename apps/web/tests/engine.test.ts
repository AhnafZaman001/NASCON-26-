/* eslint-disable @typescript-eslint/no-explicit-any */
const store: Record<string,string> = {};
(globalThis as any).localStorage = { getItem: (k:string)=>store[k]??null, setItem:(k:string,v:string)=>{store[k]=v} };
(globalThis as any).window = { addEventListener(){} };
let off = 0; const real = Date.now; Date.now = () => real() + off;
import assert from "node:assert";
(async () => {
const S = await import("../src/lib/store");
S.hydrate(); S.loginAs("m_owner");
const g = () => S.getState();
const l3 = () => g().leads.find(l => l.id === "l3")!;
assert.equal(l3().ownerId, "m_bilal");
off = 26_000; S.tick(); S.tick(); S.tick();
console.log("after expiry:", l3().ownerId, "level", l3().level, "esc", l3().escalations, "hist", l3().history.length);
assert.equal(l3().escalations, 1, "no double escalation");
assert.notEqual(l3().ownerId, "m_bilal");
assert.ok(!["m_zoya","m_usman"].includes(l3().ownerId!), "busy/offline never receive");
off += 31_000; S.tick(); console.log("level2 owner", l3().ownerId); assert.equal(l3().ownerId, "m_admin");
off += 31_000; S.tick(); console.log("level3 owner", l3().ownerId); assert.equal(l3().ownerId, "m_mgr");
off += 61_000; S.tick(); console.log("exhausted", l3().exhausted, l3().deadlineAt); assert.ok(l3().exhausted && l3().deadlineAt === null);
assert.ok(S.recoveryItems(g()).some(r => r.lead.id === "l3"));
assert.ok(g().sync.some(e => e.integration === "notifications" && e.result === "ok"), "external alert fired");
// availability
S.captureLead("Test A", "+923111111111", "", ""); S.captureLead("Test B", "+923111111112", "", "");
const fresh = g().leads.filter(l => ["Test A","Test B"].includes(g().contacts.find(c=>c.id===l.contactId)!.name));
console.log("new lead owners", fresh.map(l => l.ownerId)); assert.ok(fresh.every(l => l.ownerId && ["m_owner","m_admin","m_mgr","m_bilal"].includes(l.ownerId)));
S.setStatus("m_bilal","leave");
assert.ok(!g().leads.some(l => l.ownerId==="m_bilal" && l.status==="assigned"), "unacked leads reassigned on leave");
// stage rules
const r = S.moveOpp("o2","st_prop"); console.log("required field:", r.error); assert.equal(r.ok,false);
S.setOppCustom("o2","f_budget","$50k - $150k"); assert.equal(S.moveOpp("o2","st_prop").ok,true);
// delete stage safety
assert.equal(S.deleteStage("pl_sales","st_prop").ok,false); assert.equal(S.deleteStage("pl_sales","st_prop","st_qual").ok,true);
assert.ok(g().opps.every(o => g().pipelines.find(p=>p.id===o.pipelineId)!.stages.some(s=>s.id===o.stageId)), "no orphaned opps");
// messaging
assert.equal(S.sendMessage("c9","hi").ok,false);
const n0=g().messages.length; S.simulateDuplicateWebhook("+923009990001"); console.log("dup webhook msgs added:", g().messages.length-n0); assert.equal(g().messages.length-n0,1);
assert.equal(g().leads.filter(l=>g().contacts.find(c=>c.id===l.contactId)?.phone==="+923009990001").length,1);
// payments idempotent
S.paymentEvent("p2","paid"); S.paymentEvent("p2","paid"); assert.equal(g().sync.filter(e=>e.result==="duplicate"&&e.integration==="payments").length,1);
// permission enforcement in actions
S.loginAs("m_bilal"); const before=g().settings.maxOpenLeads; S.setSettings({maxOpenLeads:99}); assert.equal(g().settings.maxOpenLeads,before,"user can't change rules");
S.loginAs("m_admin"); const ow=g().members.find(m=>m.id==="m_owner")!.perms.length; S.updateMember("m_owner",{perms:[]}); assert.equal(g().members.find(m=>m.id==="m_owner")!.perms.length,ow,"admin can't modify owner");
// appointment conflicts
S.loginAs("m_owner"); const t=Date.now(); const a=g().appointments[0];
assert.equal(S.bookAppointment({contactId:"c2",oppId:null,memberId:a.memberId,title:"x",start:a.start+1000,end:a.end-1000,tz:"UTC"}).ok,false);
assert.equal(S.bookAppointment({contactId:"c2",oppId:null,memberId:"m_zoya",title:"x",start:t+1e6,end:t+2e6,tz:"UTC"}).ok,false,"no calendar -> can't book");
console.log("ALL ENGINE CHECKS PASSED");
})().catch(e => { console.error("FAIL", e.message); process.exit(1); });
