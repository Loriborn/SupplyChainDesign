import { useState, useRef, useCallback, useEffect, useMemo } from "react";

// ─── Layout ───────────────────────────────────────────────────────────────────
const GRID = 40;
const BW = 200, BH_BASE = 88;

// ─── Step types ───────────────────────────────────────────────────────────────
const STEP_TYPES  = ["get_resource","convert_resource","deliver","flavor_text"];
const STEP_LABELS = { get_resource:"Gather", convert_resource:"Convert", deliver:"Deliver", flavor_text:"Flavor" };
const STEP_BG     = { get_resource:"#e8f9ee", convert_resource:"#e6f0ff", deliver:"#fef0e4", flavor_text:"#fffbe6" };
const STEP_BD     = { get_resource:"#7ec8a0", convert_resource:"#84b4e8", deliver:"#e8a060", flavor_text:"#e8c84a" };

// ─── Frutiger Aero palette ────────────────────────────────────────────────────
const C = {
  sky:      "#b0d8f0",
  dot:      "#80b4d4",
  white:    "#ffffff",
  panelBg:  "#f0f8ff",
  toolbar:  "linear-gradient(180deg,#fafeff 0%,#daeeff 100%)",
  titleBar: "linear-gradient(180deg,#6cb8f8 0%,#2268c8 52%,#1858b4 100%)",
  cardTop:  "linear-gradient(180deg,#78c4f4 0%,#3a8edc 100%)",
  cardTopSel:"linear-gradient(180deg,#50aaee 0%,#1c66cc 100%)",
  btn:      "linear-gradient(180deg,#f2f9ff 0%,#c8dff8 100%)",
  btnBdr:   "#5898cc",
  btnTxt:   "#0a2444",
  text:     "#0a2444",
  muted:    "#4a6a8a",
  border:   "#78b4dc",
  rowBg:    "linear-gradient(180deg,#f4faff 0%,#eaf3ff 100%)",
  rowBdr:   "#b4d4ee",
  chip: {
    green:  { bg:"#d8f5e4", bd:"#50a878", fg:"#063820" },
    amber:  { bg:"#fff0d4", bd:"#c09040", fg:"#5c2c00" },
    blue:   { bg:"#d4ecff", bd:"#5ca0d8", fg:"#082c58" },
    purple: { bg:"#eedaff", bd:"#9060cc", fg:"#340860" },
    orange: { bg:"#fde8d0", bd:"#d07830", fg:"#5c2200" },
    teal:   { bg:"#d0f5ee", bd:"#38a888", fg:"#043828" },
  },
  natTop:    "linear-gradient(180deg,#7ed87a 0%,#3a9c38 100%)",
  natTopSel: "linear-gradient(180deg,#60cc5c 0%,#247020 100%)",
  natBorder: "#4a9848",
  natBg:     "#f2fbf2",
  natTitleBar: "linear-gradient(180deg,#6cd87a 0%,#228c38 52%,#186830 100%)",
  natPanelBg:  "#f0fbf0",
};

const IST = {
  background:C.white, border:"1px solid #a8d0ec", borderRadius:4,
  padding:"3px 6px", fontSize:11, fontFamily:"inherit", color:C.text,
  outline:"none", width:"100%",
};
const SBT = {
  background:C.btn, border:`1px solid ${C.btnBdr}`, borderRadius:4,
  color:C.btnTxt, padding:"2px 8px", cursor:"pointer", fontSize:10,
  fontFamily:"inherit", fontWeight:700,
  boxShadow:"inset 0 1px 0 rgba(255,255,255,.8)", flexShrink:0,
};
const DBT = {
  ...SBT,
  background:"linear-gradient(180deg,#ffe4e4 0%,#f8b8b8 100%)",
  border:"1px solid #cc7070", color:"#800000",
};

// ─── ID counters ──────────────────────────────────────────────────────────────
let _ty=10, _i=10, _t=10, _s=10, _nr=20, _nri=20;
const nty=()=>++_ty, ni=()=>++_i, nt=()=>++_t, ns=()=>++_s;
const nnrt=()=>++_nr, nnri=()=>++_nri;

// ─── Geometry ─────────────────────────────────────────────────────────────────
const snap = v => Math.round(v/GRID)*GRID;
const d2   = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const CARD_H_EST = 160;
const ctr  = (n, h=CARD_H_EST) => ({ x:n.x+BW/2, y:n.y+h/2 });

function buildingEdge(b, dx, dy, cardH) {
  const angle  = Math.atan2(dy,dx);
  const cx=b.x+BW/2, cy=b.y+cardH/2, hw=BW/2, hh=cardH/2;
  const ac=Math.abs(Math.cos(angle)), as=Math.abs(Math.sin(angle));
  const r = ac<1e-9?hh : as<1e-9?hw : Math.min(hw/ac,hh/as);
  return { x:cx+Math.cos(angle)*r, y:cy+Math.sin(angle)*r };
}

const inB = (p,b,pad=14,h=BH_BASE) =>
  p.x>=b.x-pad && p.x<=b.x+BW+pad && p.y>=b.y-pad && p.y<=b.y+h+pad;

const linePath = (x1,y1,x2,y2) => `M${x1},${y1} L${x2},${y2}`;

// ─── Data helpers ─────────────────────────────────────────────────────────────
function typeSummary(type) {
  const In=new Map(), Out=new Map(), W=new Map(), Del=[];
  type.workTasks.forEach(t => {
    t.workerRequirements?.forEach(w => {
      if (w.workerType?.trim()) W.set(w.workerType.trim(),{emoji:w.emoji||"👷",qty:w.qty||1});
    });
    t.steps.forEach(s => {
      if (s.stepType==="convert_resource") {
        if (s.inResource?.trim()) { const k=s.inResource.trim(),c=In.get(k)||{qty:0}; In.set(k,{...c,qty:c.qty+(s.inQty||1)}); }
        if (s.outResource?.trim()) { const k=s.outResource.trim(),c=Out.get(k)||{qty:0}; Out.set(k,{...c,qty:c.qty+(s.outQty||1)}); }
      } else if (s.stepType==="get_resource") {
        if (s.outResource?.trim()) { const k=s.outResource.trim(),c=Out.get(k)||{qty:0}; Out.set(k,{...c,qty:c.qty+(s.outQty||1)}); }
      } else if (s.stepType==="deliver") {
        if (s.resource?.trim()) Del.push({name:s.resource.trim(),qty:s.qty||1});
      }
    });
  });
  In.forEach((_,k)=>Out.delete(k));
  return {
    In:  [...In.entries()].map(([name,v])=>({name,qty:v.qty})),
    Out: [...Out.entries()].map(([name,v])=>({name,qty:v.qty})),
    W:   [...W.entries()].map(([name,v])=>({name,...v})),
    Del,
  };
}

function typeOutputs(type) {
  const s=new Set();
  type.workTasks.forEach(t=>t.steps.forEach(st=>{
    if ((st.stepType==="convert_resource"||st.stepType==="get_resource")&&st.outResource?.trim())
      s.add(st.outResource.trim());
  }));
  return [...s];
}

// Auto-label: "Brewery" if sole instance, "Brewery #2" if siblings
function instanceLabel(inst, types, instances) {
  const type=types.find(t=>t.id===inst.typeId);
  if (!type) return `Instance #${inst.id}`;
  const peers=instances.filter(i=>i.typeId===inst.typeId);
  if (peers.length===1) return type.name;
  return `${type.name} #${peers.findIndex(i=>i.id===inst.id)+1}`;
}

// ─── Derive edges from deliver + gather steps ─────────────────────────────────
// kind: "deliver" | "gather"
// For deliver: fromInst (building) → target (building)
// For gather:  fromInst (building) → target (natInstance)
function deriveEdges(types, instances, natInstances, cardHeights) {
  const edges = [];

  instances.forEach(inst => {
    const type = types.find(t=>t.id===inst.typeId);
    if (!type) return;
    type.workTasks.forEach(task => {
      task.steps.forEach(step => {

        // ── Deliver ──────────────────────────────────────────────────────────
        if (step.stepType === "deliver") {
          let target = null, unresolved = false;
          if (step.destinationType === "specified") {
            if (step.destinationInstanceId) {
              target = instances.find(i=>i.id===step.destinationInstanceId) || null;
              if (!target) unresolved = true;
            } else { unresolved = true; }
          } else {
            if (!step.destinationTypeId) { unresolved=true; }
            else {
              const candidates = instances.filter(i=>i.typeId===step.destinationTypeId && i.id!==inst.id);
              if (candidates.length===0) { unresolved=true; }
              else {
                const fh = cardHeights[inst.id]||CARD_H_EST;
                const fc = ctr(inst,fh);
                target = candidates.reduce((best,c)=>{
                  const th=cardHeights[c.id]||CARD_H_EST;
                  const bh=cardHeights[best.id]||CARD_H_EST;
                  return d2(fc,ctr(c,th)) < d2(fc,ctr(best,bh)) ? c : best;
                });
              }
            }
          }
          edges.push({
            key: `${inst.id}-${task.id}-${step.id}`,
            kind: "deliver",
            fromInst: inst, taskId: task.id, taskName: task.name,
            step, target, unresolved,
          });
        }

        // ── Gather ───────────────────────────────────────────────────────────
        if (step.stepType === "get_resource") {
          // Only emit an edge if the step has sourceType set (opt-in)
          if (!step.sourceType) return;
          const resource = step.outResource?.trim();
          if (!resource) { edges.push({key:`${inst.id}-${task.id}-${step.id}-g`,kind:"gather",fromInst:inst,taskId:task.id,taskName:task.name,step,target:null,unresolved:true}); return; }

          let target = null, unresolved = false;
          if (step.sourceType === "specified") {
            if (step.sourceNatInstanceId) {
              target = natInstances.find(i=>i.id===step.sourceNatInstanceId) || null;
              if (!target) unresolved = true;
            } else { unresolved = true; }
          } else {
            // nearest nat instance whose inventory has this resource with qty > 0
            const candidates = natInstances.filter(i=>(i.inventory||{})[resource]>0);
            if (candidates.length===0) { unresolved=true; }
            else {
              const fh = cardHeights[inst.id]||CARD_H_EST;
              const fc = ctr(inst,fh);
              target = candidates.reduce((best,c)=>{
                const th=cardHeights[`n${c.id}`]||CARD_H_EST;
                const bh=cardHeights[`n${best.id}`]||CARD_H_EST;
                return d2(fc,ctr(c,th)) < d2(fc,ctr(best,bh)) ? c : best;
              });
            }
          }
          edges.push({
            key: `${inst.id}-${task.id}-${step.id}-g`,
            kind: "gather",
            fromInst: inst, taskId: task.id, taskName: task.name,
            step, target, unresolved,
          });
        }

      });
    });
  });
  return edges;
}

// ─── Sample data ──────────────────────────────────────────────────────────────
const INIT_TYPES = [
  {
    id:1, name:"Brewery", emoji:"🍺",
    workTasks:[{
      id:1, name:"Brew & Deliver Ale",
      workerRequirements:[{workerType:"Brewer",qty:1,emoji:"⚗️"}],
      steps:[
        {id:1, name:"Gather Grain",  stepType:"get_resource", time:5,
          outResource:"Grain", outQty:4,
          sourceType:"nearest", sourceNatInstanceId:null},
        {id:2, name:"Mash & Brew",   stepType:"convert_resource", time:30, inResource:"Grain",  inQty:4, outResource:"Ale", outQty:2},
        {id:3, name:"Fermenting…",   stepType:"flavor_text",      time:60, text:"Ale slowly ferments in the barrel."},
        {id:4, name:"Deliver Ale",   stepType:"deliver",          time:0,
          resource:"Ale", qty:2,
          destinationType:"nearest", destinationTypeId:2, destinationInstanceId:null},
      ],
    }],
  },
  {
    id:2, name:"Inn", emoji:"🏨",
    workTasks:[{
      id:2, name:"Serve Drinks",
      workerRequirements:[{workerType:"Bartender",qty:1,emoji:"🍻"},{workerType:"Waitress",qty:1,emoji:"💁"}],
      steps:[
        {id:5, name:"Pour & Serve", stepType:"convert_resource", time:5,  inResource:"Ale",  inQty:1, outResource:"Coins", outQty:3},
        {id:6, name:"Small talk",   stepType:"flavor_text",      time:10, text:"The bartender makes smalltalk with regulars."},
      ],
    }],
  },
];

const INIT_INSTANCES = [
  { id:1, typeId:1, x:80,  y:220, disabledTasks:[], inventory:{} },
  { id:2, typeId:2, x:500, y:220, disabledTasks:[], inventory:{ Ale:4, Coins:12 } },
];

// Auto-label for nat resource instances
function natInstanceLabel(inst, natTypes, natInstances) {
  const type = natTypes.find(t=>t.id===inst.typeId);
  if (!type) return `Resource #${inst.id}`;
  const peers = natInstances.filter(i=>i.typeId===inst.typeId);
  if (peers.length===1) return type.name;
  return `${type.name} #${peers.findIndex(i=>i.id===inst.id)+1}`;
}

// ─── Sample natural resource data ────────────────────────────────────────────
const INIT_NAT_TYPES = [
  { id:1, name:"Whispering Forest", emoji:"🌲",
    baseInventory:{ Yew:100, Elm:100, Maple:50 } },
];

const INIT_NAT_INSTANCES = [
  { id:1, typeId:1, x:320, y:60, inventory:{ Yew:100, Elm:100, Maple:50 } },
];

// ─────────────────────────────────────────────────────────────────────────────
export default function GameMap() {
  const canvasRef  = useRef(null);
  const [types,       setTypes]       = useState(INIT_TYPES);
  const [instances,   setInstances]   = useState(INIT_INSTANCES);
  const [natTypes,    setNatTypes]    = useState(INIT_NAT_TYPES);
  const [natInstances,setNatInstances]= useState(INIT_NAT_INSTANCES);
  const [pan,  setPan]  = useState({x:200,y:130});
  const [zoom, setZoom] = useState(1);
  const cardHeights = useRef({});
  const [sel,  setSel]  = useState(null);   // {type:"instance"|"edge", ...}
  const [conn, setConn] = useState(null);
  const [connHover,    setConnHover]    = useState(null);
  const [hoveredEdge,  setHoveredEdge]  = useState(null);
  const [drag, setDrag] = useState(false);
  const [picker, setPicker] = useState(null);

  const [panels, setPanels] = useState([
    {id:"dict",type:"dict",targetId:null,x:18,y:68,z:1},
  ]);
  const zTop = useRef(100);

  const S = useRef({types,instances,natTypes,natInstances,pan,zoom});
  useEffect(()=>{ S.current={types,instances,natTypes,natInstances,pan,zoom}; },
    [types,instances,natTypes,natInstances,pan,zoom]);

  const G    = useRef(null);
  const ptrs = useRef({});

  // ── Dictionary — just name/emoji registries, no use counts ────────────────
  const dict = useMemo(()=>{
    const R={}, W={};
    types.forEach(type=>{
      type.workTasks.forEach(t=>{
        t.workerRequirements?.forEach(w=>{
          if (!w.workerType?.trim()) return;
          const k=w.workerType.trim();
          if (!W[k]) W[k]={emoji:w.emoji||"👷"};
        });
        t.steps.forEach(s=>{
          [s.inResource,s.outResource,s.resource].forEach(r=>{
            if (!r?.trim()) return;
            if (!R[r.trim()]) R[r.trim()]={};
          });
        });
      });
    });
    // Also include resources declared in natural resource base inventories
    natTypes.forEach(nt=>{
      Object.keys(nt.baseInventory||{}).forEach(r=>{
        if (r.trim() && !R[r.trim()]) R[r.trim()]={};
      });
    });
    return {R,W};
  },[types, natTypes]);

  // ── Panel helpers ──────────────────────────────────────────────────────────
  const raisePanelId = useCallback(id=>{
    zTop.current++;
    setPanels(p=>p.map(w=>w.id===id?{...w,z:zTop.current}:w));
  },[]);

  const openPanel = useCallback((type,targetId=null)=>{
    const id = targetId!=null?`${type}-${targetId}`:type;
    zTop.current++;
    setPanels(prev=>{
      if (prev.find(w=>w.id===id))
        return prev.map(w=>w.id===id?{...w,z:zTop.current}:w);
      const off=(prev.length%5)*20;
      return [...prev,{id,type,targetId,x:70+off,y:68+off,z:zTop.current}];
    });
  },[]);

  const closePanel = useCallback(id=>setPanels(p=>p.filter(w=>w.id!==id)),[]);
  const movePanel  = useCallback((id,x,y)=>setPanels(p=>p.map(w=>w.id===id?{...w,x,y}:w)),[]);

  // ── Canvas → world ─────────────────────────────────────────────────────────
  const toWorld = useCallback((cx,cy)=>{
    const r=canvasRef.current.getBoundingClientRect();
    return {
      x:(cx-r.left-S.current.pan.x)/S.current.zoom,
      y:(cy-r.top -S.current.pan.y)/S.current.zoom,
    };
  },[]);

  // ── Pointer down ───────────────────────────────────────────────────────────
  const onPD = useCallback(e=>{
    ptrs.current[e.pointerId]={x:e.clientX,y:e.clientY};
    const ap=Object.values(ptrs.current);

    if (ap.length===2) {
      const[a,b]=ap;
      G.current={type:"pinch",sd:d2(a,b),sz:S.current.zoom,
        mx:(a.x+b.x)/2,my:(a.y+b.y)/2,sp:{...S.current.pan}};
      setConn(null); setDrag(true); return;
    }

    if (e.button!==0&&e.button!==1) return;
    if (G.current?.type==="pinch") return;
    setPicker(null);

    const bidEl  = e.target.closest("[data-bid]");
    const nidEl  = e.target.closest("[data-nid]");
    const nodeEl = bidEl || nidEl;
    const isNat  = !!nidEl && !bidEl;
    const ixEl   = e.target.closest("[data-ix]");
    const EDGE_HIT = 6;

    if (nodeEl && !ixEl) {
      const id   = parseInt(isNat ? nidEl.dataset.nid : bidEl.dataset.bid);
      const inst = isNat
        ? S.current.natInstances.find(x=>x.id===id)
        : S.current.instances.find(x=>x.id===id);
      if (!inst) return;

      const p     = toWorld(e.clientX,e.clientY);
      const cardH = cardHeights.current[(isNat?"n":"")+id]||CARD_H_EST;
      const nearL = p.x-inst.x         <EDGE_HIT;
      const nearR = inst.x+BW-p.x      <EDGE_HIT;
      const nearT = p.y-inst.y         <EDGE_HIT;
      const nearB = inst.y+cardH-p.y   <EDGE_HIT;

      // Only building instances can start a conn drag
      if (!isNat && (nearL||nearR||nearT||nearB)) {
        const c=ctr(inst,cardH);
        G.current={type:"conn",fromId:id};
        setConn({x1:c.x,y1:c.y,x2:c.x,y2:c.y});
        setSel(null);
        try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){}
        e.preventDefault(); setDrag(true);
      } else {
        setSel({type: isNat?"natinstance":"instance", id});
        G.current={type:"node",id,isNat,sx:e.clientX,sy:e.clientY,ox:inst.x,oy:inst.y};
        setDrag(true);
      }
    } else if (!nodeEl) {
      setSel(null);
      G.current={type:"pan",sx:e.clientX,sy:e.clientY,
        px:S.current.pan.x,py:S.current.pan.y,moved:false};
      try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){}
      setDrag(true);
    }
  },[toWorld]);

  // ── Pointer move ───────────────────────────────────────────────────────────
  const onPM = useCallback(e=>{
    ptrs.current[e.pointerId]={x:e.clientX,y:e.clientY};
    const g=G.current; if(!g) return;

    if (g.type==="pinch") {
      const pts=Object.values(ptrs.current); if(pts.length<2) return;
      const[a,b]=pts, nz=Math.min(Math.max(g.sz*(d2(a,b)/g.sd),.1),5);
      const r=canvasRef.current.getBoundingClientRect();
      const mx=g.mx-r.left, my=g.my-r.top;
      setPan({x:mx-(mx-g.sp.x)*(nz/g.sz),y:my-(my-g.sp.y)*(nz/g.sz)});
      setZoom(nz);
    } else if (g.type==="pan") {
      const dx=e.clientX-g.sx, dy=e.clientY-g.sy;
      if (Math.hypot(dx,dy)>6) g.moved=true;
      setPan({x:g.px+dx,y:g.py+dy});
    } else if (g.type==="node") {
      const dz=S.current.zoom;
      const setter = g.isNat ? setNatInstances : setInstances;
      setter(prev=>prev.map(b=>b.id===g.id
        ?{...b,x:snap(g.ox+(e.clientX-g.sx)/dz),y:snap(g.oy+(e.clientY-g.sy)/dz)}:b));
    } else if (g.type==="conn") {
      const p  = toWorld(e.clientX,e.clientY);
      const fb = S.current.instances.find(b=>b.id===g.fromId);
      if (!fb) return;
      const fh=cardHeights.current[fb.id]||CARD_H_EST;
      const c=ctr(fb,fh), dx=p.x-c.x, dy=p.y-c.y, dl=Math.hypot(dx,dy)||1;
      const ep=buildingEdge(fb,dx/dl,dy/dl,fh);
      setConn({x1:ep.x,y1:ep.y,x2:p.x,y2:p.y});
      const hov=S.current.instances.find(b=>
        b.id!==g.fromId&&inB(p,b,14,cardHeights.current[b.id]||CARD_H_EST));
      setConnHover(hov?.id??null);
    }
  },[toWorld]);

  // ── Pointer up ─────────────────────────────────────────────────────────────
  const onPU = useCallback(e=>{
    delete ptrs.current[e.pointerId];
    const g=G.current;
    if (g?.type==="pinch") {
      if (Object.keys(ptrs.current).length<2) { G.current=null; setDrag(false); }
      return;
    }
    G.current=null; setDrag(false);
    if (!g) return;

    if (g.type==="conn") {
      setConnHover(null);
      const p  = toWorld(e.clientX,e.clientY);
      const fb = S.current.instances.find(b=>b.id===g.fromId);
      const tb = S.current.instances.find(b=>
        b.id!==g.fromId&&inB(p,b,14,cardHeights.current[b.id]||CARD_H_EST));
      // Dragging to another node: open source type editor so user can add a deliver step
      if (fb && tb) {
        const srcType = S.current.types.find(t=>t.id===fb.typeId);
        if (srcType) {
          openPanel("type",srcType.id);
          // Flash hint — small banner shown briefly in editor (via state)
          setDragHint({fromTypeId:srcType.id, toTypeId:tb.typeId,
            toTypeName: S.current.types.find(t=>t.id===tb.typeId)?.name||"?"});
          setTimeout(()=>setDragHint(null), 6000);
        }
      }
      setConn(null);
    }
  },[toWorld,openPanel]);

  const [dragHint, setDragHint] = useState(null);

  // ── Wheel zoom ─────────────────────────────────────────────────────────────
  useEffect(()=>{
    const el=canvasRef.current;
    const fn=e=>{
      e.preventDefault();
      const r=el.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
      const f=e.deltaY<0?1.12:.9, oz=S.current.zoom, op=S.current.pan;
      const nz=Math.min(Math.max(oz*f,.1),5);
      setPan({x:mx-(mx-op.x)*(nz/oz),y:my-(my-op.y)*(nz/oz)});
      setZoom(nz);
    };
    el.addEventListener("wheel",fn,{passive:false});
    return()=>el.removeEventListener("wheel",fn);
  },[]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(()=>{
    const fn=e=>{
      const inInput=document.activeElement?.matches?.("input,textarea,select");
      if ((e.key==="Delete"||e.key==="Backspace")&&sel&&!inInput) {
        if (sel.type==="instance"||sel.type==="natinstance") deleteSel(sel);
        setSel(null);
      }
      if (e.key==="Escape") { setSel(null); setPicker(null); }
    };
    window.addEventListener("keydown",fn);
    return()=>window.removeEventListener("keydown",fn);
  // eslint-disable-next-line
  },[sel]);

  function deleteSel(s) {
    if (!s) return;
    if (s.type==="natinstance") {
      setNatInstances(p=>p.filter(b=>b.id!==s.id));
      return;
    }
    if (s.type!=="instance") return;
    // Clean up any "specified" deliver steps pointing to this instance
    setTypes(prev=>prev.map(type=>({
      ...type,
      workTasks: type.workTasks.map(task=>({
        ...task,
        steps: task.steps.map(step=>
          step.stepType==="deliver"&&step.destinationInstanceId===s.id
            ? {...step, destinationInstanceId:null, destinationType:"nearest"}
            : step
        ),
      })),
    })));
    setInstances(p=>p.filter(b=>b.id!==s.id));
  }

  // ── Derived edges (recomputed each render, cheap) ──────────────────────────
  const edges = deriveEdges(types, instances, natInstances, cardHeights.current);

  const gs = GRID*zoom;
  const cursor = drag?"grabbing":"default";

  return (
    <div style={{width:"100vw",height:"100vh",overflow:"hidden",background:C.sky,
      position:"relative",fontFamily:"'Nunito','Segoe UI',Tahoma,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;}
        .abtn:hover{filter:brightness(1.08);}
        .abtn:active{filter:brightness(.92);}
        .drop-row:hover{background:#d0eaff!important;}
        ::-webkit-scrollbar{width:6px;}
        ::-webkit-scrollbar-track{background:#d4eaf8;}
        ::-webkit-scrollbar-thumb{background:#88c0e0;border-radius:3px;}
        input,select,textarea{-webkit-user-select:text;user-select:text;}
        button{-webkit-tap-highlight-color:transparent;}
      `}</style>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",zIndex:4000,
        background:C.toolbar,border:"1px solid #82bce0",borderRadius:10,
        padding:"5px 14px",display:"flex",gap:5,alignItems:"center",
        boxShadow:"0 2px 16px rgba(0,70,160,.2),inset 0 1px 0 rgba(255,255,255,.9)"}}>
        <span style={{color:"#0a3060",fontSize:13,fontWeight:800,marginRight:4,
          textShadow:"0 1px 0 rgba(255,255,255,.8)"}}>⛏️ GAMEMAP</span>
        <TDiv/>
        <TBtn onClick={()=>{setZoom(1);setPan({x:200,y:130});}}>⌂ Reset</TBtn>
        <span style={{color:"#8aaac8",fontSize:11,minWidth:38,textAlign:"center"}}>{Math.round(zoom*100)}%</span>
        <TDiv/>
        <TBtn onClick={()=>openPanel("dict")}>📚 Dictionary</TBtn>
        <TBtn onClick={()=>openPanel("world")}>🌍 World</TBtn>
        {(sel?.type==="instance"||sel?.type==="natinstance")&&(
          <><TDiv/><TBtn danger onClick={()=>{deleteSel(sel);setSel(null);}}>✕ Delete</TBtn></>
        )}
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <div ref={canvasRef}
        onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
        onDoubleClick={e=>{
          if (e.target.closest("[data-bid]")||e.target.closest("[data-nid]")) return;
          const p=toWorld(e.clientX,e.clientY);
          setPicker({wx:p.x,wy:p.y,sx:e.clientX,sy:e.clientY});
        }}
        style={{width:"100%",height:"100%",cursor,position:"relative",
          backgroundImage:`radial-gradient(circle,${C.dot} 1.5px,transparent 1.5px)`,
          backgroundSize:`${gs}px ${gs}px`,
          backgroundPosition:`${pan.x%gs}px ${pan.y%gs}px`,
          userSelect:"none",touchAction:"none",WebkitUserSelect:"none"}}>

        {/* Node layer */}
        <div style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          transformOrigin:"0 0",position:"absolute",zIndex:1}}>
          {instances.map(inst=>{
            const type=types.find(t=>t.id===inst.typeId);
            if (!type) return null;
            const instEdges=edges.filter(e=>e.fromInst.id===inst.id);
            const hasUnresolved=instEdges.some(e=>e.unresolved);
            return(
              <BuildingCard key={inst.id}
                instance={inst} type={type}
                summary={typeSummary(type)}
                label={instanceLabel(inst,types,instances)}
                isSelected={sel?.type==="instance"&&sel?.id===inst.id}
                isConnTarget={connHover===inst.id}
                hasUnresolved={hasUnresolved}
                onHeight={h=>{ cardHeights.current[inst.id]=h; }}
                onDoubleClick={()=>{
                  setSel({type:"instance",id:inst.id});
                  openPanel("type",inst.typeId);
                }}/>
            );
          })}
          {natInstances.map(inst=>{
            const type=natTypes.find(t=>t.id===inst.typeId);
            if (!type) return null;
            return(
              <NatResourceCard key={`n${inst.id}`}
                instance={inst} type={type}
                label={natInstanceLabel(inst,natTypes,natInstances)}
                isSelected={sel?.type==="natinstance"&&sel?.id===inst.id}
                onHeight={h=>{ cardHeights.current[`n${inst.id}`]=h; }}
                onDoubleClick={()=>{
                  setSel({type:"natinstance",id:inst.id});
                  openPanel("nattype",inst.typeId);
                }}/>
            );
          })}
        </div>

        {/* SVG edge layer */}
        <svg style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",
          pointerEvents:"none",overflow:"visible",zIndex:2}}>
          <defs>
            <filter id="eds" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#002870" floodOpacity=".32"/>
            </filter>
          </defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {edges.map(edge=>{
              const {key,fromInst,step,target,unresolved,taskName} = edge;

              const isGather = edge.kind === "gather";

              // Unresolved: draw a short stub from the source node
              if (unresolved || !target) {
                const fh=cardHeights.current[fromInst.id]||CARD_H_EST;
                const ep=buildingEdge(fromInst,1,0.3,fh);
                const stubColor = "#d07820";
                const unresTxt = isGather
                  ? `⚠ ← ${step.outResource||"?"} (no source)`
                  : `⚠ ${step.resource||"?"} → ${step.destinationType==="nearest"
                      ? (types.find(t=>t.id===step.destinationTypeId)?.name||"?")
                      : "unset"}`;
                return(
                  <g key={key} opacity={.7}>
                    <line x1={ep.x} y1={ep.y} x2={ep.x+40} y2={ep.y+12}
                      stroke={stubColor} strokeWidth={4} strokeDasharray="6,4"
                      style={{pointerEvents:"none"}}/>
                    <text x={ep.x+44} y={ep.y+15} fontSize={9} fill={stubColor}
                      fontFamily="Nunito,'Segoe UI',sans-serif" fontWeight="700"
                      style={{pointerEvents:"none",userSelect:"none"}}>{unresTxt}</text>
                  </g>
                );
              }

              // Resolved edge
              const fh=cardHeights.current[fromInst.id]||CARD_H_EST;
              const thKey = isGather ? `n${target.id}` : target.id;
              const th=cardHeights.current[thKey]||CARD_H_EST;
              const fc=ctr(fromInst,fh), tc=ctr(target,th);
              const cdx=tc.x-fc.x, cdy=tc.y-fc.y, clen=Math.hypot(cdx,cdy)||1;
              const udx=cdx/clen, udy=cdy/clen;
              const nx=-udy, ny=udx;

              // Sibling offset: edges from the same source to the same target
              const siblings=edges.filter(e=>
                !e.unresolved&&e.target&&
                e.fromInst.id===fromInst.id&&e.target.id===target.id&&e.kind===edge.kind);
              const idx=siblings.findIndex(e=>e.key===key);
              const offset=(idx-(siblings.length-1)/2)*18;

              const se=buildingEdge(fromInst, udx, udy, fh);
              const te=buildingEdge(target,  -udx,-udy, th);
              const x1=se.x+nx*offset, y1=se.y+ny*offset;
              const x2=te.x+nx*offset, y2=te.y+ny*offset;

              const edgeKey=key;
              const isSel=sel?.type==="edge"&&sel?.key===edgeKey;
              const isHov=hoveredEdge===edgeKey;

              // Gather = green, Deliver = blue
              const baseCol   = isGather ? "#2a9050" : "#2878d8";
              const selCol    = isGather ? "#1a5c34" : "#0030a0";
              const hovCol    = isGather ? "#228040" : "#0055cc";
              const strokeCol = isSel?selCol:isHov?hovCol:baseCol;
              const strokeW   = isSel?9:isHov?8:6;
              const opacity   = isSel?1:isHov?1:.8;

              const aw=strokeW*1.2, al=strokeW*2.6;
              const atdx=x2-x1, atdy=y2-y1, atl=Math.hypot(atdx,atdy)||1;
              const atx=atdx/atl, aty=atdy/atl;
              const abx=x2-atx*al, aby=y2-aty*al;
              const arrowPts=`${x2},${y2} ${abx-aty*aw},${aby+atx*aw} ${abx+aty*aw},${aby-atx*aw}`;
              const pathD=`M${x1},${y1} L${abx},${aby}`;
              const hitD =`M${x1},${y1} L${x2},${y2}`;

              // Label: gather shows "← 4× Grain", deliver shows "2× Ale"
              const lbl = isGather
                ? `← ${step.outQty||1}× ${step.outResource||"?"}`
                : `${step.qty||1}× ${step.resource||"?"}`;
              const mlx=(x1+x2)/2+nx*18, mly=(y1+y2)/2+ny*18;
              const lblW=(lbl.length*5.8)+12;

              const selectEdge=ev=>{ev.stopPropagation();setSel({type:"edge",key:edgeKey});};

              return(
                <g key={key} opacity={opacity}>
                  <path d={hitD} stroke="transparent" strokeWidth={30} fill="none"
                    style={{cursor:"pointer",pointerEvents:"stroke"}}
                    onPointerDown={selectEdge}
                    onPointerEnter={()=>setHoveredEdge(edgeKey)}
                    onPointerLeave={()=>setHoveredEdge(null)}/>
                  <path d={pathD} stroke={strokeCol} strokeWidth={strokeW} fill="none"
                    filter="url(#eds)" style={{pointerEvents:"none"}}/>
                  <path d={pathD} stroke={strokeCol} strokeWidth={strokeW} fill="none"
                    style={{pointerEvents:"none"}}/>
                  <polygon points={arrowPts} fill={strokeCol} style={{pointerEvents:"none"}}/>
                  {lbl&&(
                    <g style={{cursor:"pointer",pointerEvents:"all"}}
                      onPointerDown={selectEdge}
                      onPointerEnter={()=>setHoveredEdge(edgeKey)}
                      onPointerLeave={()=>setHoveredEdge(null)}>
                      <rect x={mlx-lblW/2} y={mly-11} width={lblW} height={15}
                        rx={4} fill={strokeCol} opacity={.93}/>
                      <text x={mlx} y={mly} textAnchor="middle"
                        fontSize={Math.max(8,Math.min(11,9/zoom))}
                        fill="#fff" fontFamily="Nunito,'Segoe UI',sans-serif" fontWeight="700"
                        style={{pointerEvents:"none",userSelect:"none"}}>{lbl}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Live conn preview */}
            {conn&&(
              <path d={linePath(conn.x1,conn.y1,conn.x2,conn.y2)}
                stroke="#5aaae8" strokeWidth={1.8} fill="none"
                strokeDasharray="7,4" opacity=".7" style={{pointerEvents:"none"}}/>
            )}
          </g>
        </svg>
      </div>

      <div style={{position:"absolute",bottom:10,left:10,color:"#78a8c0",fontSize:10,lineHeight:1.9}}>
        DOUBLE-CLICK CANVAS → PLACE BUILDING · DRAG BORDER → HINT DELIVER STEP · DRAG INTERIOR → MOVE · SCROLL → ZOOM · DOUBLE-CLICK NODE → EDIT TYPE
      </div>

      {/* ── Place Picker ─────────────────────────────────────────────────── */}
      {picker&&(
        <PlacePicker
          types={types} natTypes={natTypes}
          screenPos={{x:picker.sx,y:picker.sy}}
          onPlace={typeId=>{
            const newId=ni();
            setInstances(prev=>[...prev,{
              id:newId, typeId,
              x:snap(picker.wx-BW/2), y:snap(picker.wy-BH_BASE/2),
              disabledTasks:[], inventory:{},
            }]);
            setSel({type:"instance",id:newId});
            setPicker(null);
          }}
          onNewType={()=>{
            const tid=nty(), iid=ni();
            setTypes(prev=>[...prev,{id:tid,name:"New Type",emoji:"🏠",workTasks:[]}]);
            setInstances(prev=>[...prev,{
              id:iid, typeId:tid,
              x:snap(picker.wx-BW/2), y:snap(picker.wy-BH_BASE/2),
              disabledTasks:[], inventory:{},
            }]);
            setSel({type:"instance",id:iid});
            openPanel("type",tid);
            setPicker(null);
          }}
          onPlaceNat={typeId=>{
            const natType=natTypes.find(t=>t.id===typeId);
            const newId=nnri();
            setNatInstances(prev=>[...prev,{
              id:newId, typeId,
              x:snap(picker.wx-BW/2), y:snap(picker.wy-BH_BASE/2),
              inventory:{...natType?.baseInventory},
            }]);
            setSel({type:"natinstance",id:newId});
            setPicker(null);
          }}
          onNewNatType={()=>{
            const tid=nnrt(), iid=nnri();
            const newType={id:tid,name:"New Resource",emoji:"🌿",baseInventory:{}};
            setNatTypes(prev=>[...prev,newType]);
            setNatInstances(prev=>[...prev,{
              id:iid, typeId:tid,
              x:snap(picker.wx-BW/2), y:snap(picker.wy-BH_BASE/2),
              inventory:{},
            }]);
            setSel({type:"natinstance",id:iid});
            openPanel("nattype",tid);
            setPicker(null);
          }}
          onClose={()=>setPicker(null)}/>
      )}

      {/* ── Floating panels ──────────────────────────────────────────────── */}
      {panels.map(pw=>{
        const typeData   = pw.type==="type"    ? types.find(t=>t.id===pw.targetId)    : null;
        const natTypeData= pw.type==="nattype" ? natTypes.find(t=>t.id===pw.targetId) : null;
        const title =
          pw.type==="dict"    ? "📚 Dictionary" :
          pw.type==="world"   ? "🌍 World Status" :
          pw.type==="nattype" ? `🌿 Edit Resource: ${natTypeData?.name||"…"}` :
          `✏️ Edit Type: ${typeData?.name||"…"}`;
        const w = pw.type==="dict"?300:pw.type==="world"?320:400;

        return(
          <Window key={pw.id} title={title} x={pw.x} y={pw.y} z={pw.z+2000} width={w} clamped
            theme={pw.type==="nattype"?"green":"blue"}
            onMove={(x,y)=>movePanel(pw.id,x,y)}
            onClose={()=>closePanel(pw.id)}
            onFocus={()=>raisePanelId(pw.id)}>
            {pw.type==="dict"&&(
              <DictPanel dict={dict} types={types} instances={instances}
                natTypes={natTypes} natInstances={natInstances}
                onAddType={()=>{
                  const id=nty();
                  setTypes(prev=>[...prev,{id,name:"New Type",emoji:"🏠",workTasks:[]}]);
                  openPanel("type",id);
                }}
                onDeleteType={id=>{
                  setTypes(prev=>prev.filter(t=>t.id!==id));
                  closePanel(`type-${id}`);
                }}
                onEditType={id=>openPanel("type",id)}
                onEditNatType={id=>openPanel("nattype",id)}
                onDeleteNatType={id=>{
                  setNatTypes(prev=>prev.filter(t=>t.id!==id));
                  closePanel(`nattype-${id}`);
                }}/>
            )}
            {pw.type==="world"&&(
              <WorldStatus types={types} instances={instances}
                natTypes={natTypes} natInstances={natInstances}/>
            )}
            {pw.type==="nattype"&&natTypeData&&(
              <NatResourceEditor natType={natTypeData} allR={Object.keys(dict.R)}
                onChange={u=>{
                  setNatTypes(prev=>prev.map(t=>t.id===u.id?u:t));
                  // Keep all instances of this type in sync with the new base inventory
                  setNatInstances(prev=>prev.map(i=>
                    i.typeId===u.id ? {...i, inventory:{...u.baseInventory}} : i
                  ));
                }}/>
            )}
            {pw.type==="nattype"&&!natTypeData&&<Empty>Resource type was removed.</Empty>}
            {pw.type==="type"&&typeData&&(
              <BuildingEditor building={typeData} dict={dict}
                types={types} instances={instances}
                natTypes={natTypes} natInstances={natInstances}
                dragHint={dragHint?.fromTypeId===typeData.id?dragHint:null}
                onClearHint={()=>setDragHint(null)}
                onChange={u=>setTypes(prev=>prev.map(t=>t.id===u.id?u:t))}/>
            )}
            {pw.type==="type"&&!typeData&&<Empty>Type was removed.</Empty>}
          </Window>
        );
      })}
    </div>
  );
}

// ─── Place Picker ─────────────────────────────────────────────────────────────
function PlacePicker({types,natTypes,screenPos,onPlace,onNewType,onPlaceNat,onNewNatType,onClose}){
  const ref=useRef(null);
  useEffect(()=>{
    const id=setTimeout(()=>{
      const fn=e=>{ if(ref.current&&!ref.current.contains(e.target)) onClose(); };
      document.addEventListener("pointerdown",fn);
      return()=>document.removeEventListener("pointerdown",fn);
    },50);
    return()=>clearTimeout(id);
  },[onClose]);

  const left=Math.min(screenPos.x+4, window.innerWidth-244);
  const top =Math.min(screenPos.y+4, window.innerHeight-320);

  return(
    <div ref={ref} style={{position:"fixed",left,top,zIndex:9000,
      background:C.panelBg,border:"1.5px solid #60a4d4",borderRadius:8,
      boxShadow:"0 6px 32px rgba(0,40,120,.3)",padding:8,minWidth:220}}>
      <div style={{fontSize:10,fontWeight:800,color:C.muted,marginBottom:6,
        letterSpacing:".08em",textTransform:"uppercase"}}>Place Building</div>
      {types.length===0&&<Empty>No types defined yet.</Empty>}
      {types.map(type=>(
        <div key={type.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 7px",
          borderRadius:5,marginBottom:3,background:C.rowBg,border:`1px solid ${C.rowBdr}`}}>
          <span style={{fontSize:16,flexShrink:0}}>{type.emoji}</span>
          <span style={{flex:1,fontSize:12,fontWeight:600,color:C.text,
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{type.name}</span>
          <Btn onClick={()=>onPlace(type.id)}>Place</Btn>
        </div>
      ))}
      <div style={{borderTop:`1px solid ${C.border}`,marginTop:6,paddingTop:6}}>
        <button onClick={onNewType} className="abtn"
          style={{...SBT,width:"100%",display:"flex",justifyContent:"center"}}>
          + Define New Building Type
        </button>
      </div>
      <div style={{borderTop:`1px solid ${C.natBorder}`,marginTop:8,paddingTop:6}}>
        <div style={{fontSize:10,fontWeight:800,color:"#2a6828",marginBottom:5,
          letterSpacing:".08em",textTransform:"uppercase"}}>🌿 Natural Resources</div>
        {natTypes.length===0&&<Empty>No resource types defined yet.</Empty>}
        {natTypes.map(type=>(
          <div key={type.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 7px",
            borderRadius:5,marginBottom:3,
            background:"linear-gradient(180deg,#f0fbf0 0%,#e0f4e0 100%)",
            border:`1px solid ${C.natBorder}`}}>
            <span style={{fontSize:16,flexShrink:0}}>{type.emoji}</span>
            <span style={{flex:1,fontSize:12,fontWeight:600,color:"#1a3c1a",
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{type.name}</span>
            <Btn onClick={()=>onPlaceNat(type.id)}>Place</Btn>
          </div>
        ))}
        <button onClick={onNewNatType} className="abtn"
          style={{...SBT,width:"100%",display:"flex",justifyContent:"center",marginTop:3,
            background:"linear-gradient(180deg,#edfaed 0%,#c8ecc8 100%)",
            border:`1px solid ${C.natBorder}`,color:"#1a3c1a"}}>
          + Define New Resource Type
        </button>
      </div>
    </div>
  );
}

// ─── Floating Window ──────────────────────────────────────────────────────────
function Window({title,x,y,z,width,clamped=false,theme="blue",onMove,onClose,onFocus,children}){
  const dr=useRef(null), panelRef=useRef(null);
  const isGreen = theme==="green";
  const titleBar  = isGreen ? C.natTitleBar  : C.titleBar;
  const winBorder = isGreen ? C.natBorder    : "#60a4d4";
  const winShadow = isGreen
    ? "0 6px 32px rgba(0,60,0,.25),inset 0 0 0 1px rgba(255,255,255,.4)"
    : "0 6px 32px rgba(0,40,120,.3),inset 0 0 0 1px rgba(255,255,255,.4)";
  const panelBg   = isGreen ? C.natPanelBg  : C.panelBg;
  const onTitlePD=e=>{
    if(e.button!==0||e.target.closest("button"))return;
    e.stopPropagation(); onFocus();
    dr.current={sx:e.clientX,sy:e.clientY,ox:x,oy:y};
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
  };
  const onTitlePM=e=>{
    if(!dr.current)return;
    let nx=dr.current.ox+e.clientX-dr.current.sx;
    let ny=dr.current.oy+e.clientY-dr.current.sy;
    if(clamped){
      const ph=panelRef.current?.offsetHeight||100;
      nx=Math.max(0,Math.min(nx,window.innerWidth-width));
      ny=Math.max(0,Math.min(ny,window.innerHeight-ph));
    }
    onMove(nx,ny);
  };
  return(
    <div ref={panelRef} onPointerDown={e=>{e.stopPropagation();onFocus();}}
      style={{position:"absolute",left:x,top:y,width,zIndex:z,
        borderRadius:"8px 8px 5px 5px",overflow:"hidden",
        boxShadow:winShadow,
        border:`1.5px solid ${winBorder}`}}>
      <div onPointerDown={onTitlePD} onPointerMove={onTitlePM} onPointerUp={()=>dr.current=null}
        style={{background:titleBar,padding:"5px 8px",display:"flex",alignItems:"center",
          justifyContent:"space-between",cursor:"move",userSelect:"none",gap:6,
          boxShadow:"inset 0 1px 0 rgba(255,255,255,.28)"}}>
        <span style={{color:"#fff",fontSize:12,fontWeight:700,flex:1,overflow:"hidden",
          textOverflow:"ellipsis",whiteSpace:"nowrap",
          textShadow:"0 1px 3px rgba(0,0,0,.5)"}}>{title}</span>
        <button onClick={onClose} className="abtn"
          style={{background:"linear-gradient(180deg,#ff9898 0%,#cc1818 100%)",
            border:"1px solid #aa1010",borderRadius:4,color:"#fff",
            fontSize:9,fontWeight:800,width:18,height:18,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
            padding:0,flexShrink:0,boxShadow:"inset 0 1px 0 rgba(255,255,255,.3)"}}>✕</button>
      </div>
      <div style={{background:panelBg,padding:10,maxHeight:520,overflowY:"auto"}}>
        {children}
      </div>
    </div>
  );
}

// ─── Building Card ────────────────────────────────────────────────────────────
function BuildingCard({instance,type,summary,label,isSelected,isConnTarget,hasUnresolved,onDoubleClick,onHeight}){
  const cardRef=useRef(null);
  useEffect(()=>{
    if(!cardRef.current||!onHeight)return;
    const ro=new ResizeObserver(([e])=>onHeight(e.target.offsetHeight));
    ro.observe(cardRef.current);
    return()=>ro.disconnect();
  },[onHeight]);

  const{In,Out,W,Del}=summary;
  const borderColor=isConnTarget?"#00cc44":isSelected?"#0068cc":C.border;
  const bgColor    =isConnTarget?"#e4fff0":isSelected?"#e6f4ff":C.white;
  const shadow     =isConnTarget
    ?"0 0 0 3px #00cc4460,0 4px 20px rgba(0,180,80,.3)"
    :isSelected
    ?"0 0 0 2.5px #0068cc60,0 4px 20px rgba(0,90,200,.25)"
    :"0 2px 12px rgba(0,50,120,.14),inset 0 0 0 1px rgba(255,255,255,.7)";

  const[edgeHov,setEdgeHov]=useState(false);
  const EDGE_HIT=6;
  const onMove=e=>{
    if(!cardRef.current)return;
    const r=cardRef.current.getBoundingClientRect();
    const x=e.clientX-r.left, y=e.clientY-r.top;
    setEdgeHov(x<EDGE_HIT||r.width-x<EDGE_HIT||y<EDGE_HIT||r.height-y<EDGE_HIT);
  };

  return(
    <div ref={cardRef} data-bid={instance.id}
      onDoubleClick={e=>{e.stopPropagation();onDoubleClick();}}
      onMouseMove={onMove} onMouseLeave={()=>setEdgeHov(false)}
      style={{position:"absolute",left:instance.x,top:instance.y,
        width:BW,minHeight:BH_BASE,background:bgColor,
        border:`2px solid ${edgeHov?C.titleBar:borderColor}`,
        borderRadius:10,cursor:edgeHov?"crosshair":"default",
        userSelect:"none",overflow:"visible",touchAction:"none",
        boxShadow:edgeHov?`0 0 0 3px ${C.titleBar}44,0 4px 20px rgba(0,60,180,.25)`:shadow,
        transition:"border-color .1s,box-shadow .1s,background .12s"}}>
      <div style={{
        background:isConnTarget?"linear-gradient(180deg,#50e890 0%,#20a050 100%)":isSelected?C.cardTopSel:C.cardTop,
        padding:"6px 10px",borderRadius:"8px 8px 0 0",display:"flex",alignItems:"center",gap:7}}>
        <span style={{fontSize:20,lineHeight:1,flexShrink:0}}>{type.emoji}</span>
        <span style={{color:"#fff",fontSize:12,fontWeight:700,flex:1,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
          textShadow:"0 1px 2px rgba(0,0,0,.4)"}}>{label}</span>
        {hasUnresolved&&(
          <span title="Has unresolved deliver steps" style={{fontSize:13,flexShrink:0,
            filter:"drop-shadow(0 1px 2px rgba(0,0,0,.4))"}}>⚠️</span>
        )}
        <span style={{color:"rgba(255,255,255,.72)",fontSize:9,flexShrink:0,fontWeight:600}}>
          {type.workTasks.length} task{type.workTasks.length!==1?"s":""}
        </span>
      </div>
      <div style={{padding:"5px 8px 6px",display:"flex",flexDirection:"column",gap:3}}>
        {Out.length>0&&<ChipRow label="OUT" items={Out.map(r=>({name:r.name,qty:r.qty}))} color="green"/>}
        {In.length>0 &&<ChipRow label="IN"  items={In.map(r=>({name:r.name,qty:r.qty}))}  color="amber"/>}
        {Del.length>0&&<ChipRow label="→"   items={Del.map(r=>({name:r.name,qty:r.qty}))} color="orange"/>}
        {W.length>0  &&<ChipRow label="👷"  items={W.map(w=>({name:w.name,pre:w.emoji,qty:w.qty}))} color="purple"/>}
        {Out.length===0&&In.length===0&&Del.length===0&&W.length===0&&(
          <span style={{color:C.muted,fontSize:9,fontStyle:"italic",padding:"2px 0"}}>
            No tasks — double-click to edit type
          </span>
        )}
        {/* Inventory — simulation-derived, read-only */}
        {Object.keys(instance.inventory||{}).length>0&&(
          <>
            <div style={{borderTop:`1px dashed ${C.border}`,margin:"2px 0"}}/>
            <ChipRow label="📦"
              items={Object.entries(instance.inventory).map(([name,qty])=>({name,qty}))}
              color="teal"/>
          </>
        )}
      </div>
    </div>
  );
}

function ChipRow({label,items,color}){
  const fg={green:"#1a6838",amber:"#6a3c00",purple:"#420868",orange:"#5c2200",teal:"#043828",blue:"#082c58"}[color]||"#08284c";
  return(
    <div style={{display:"flex",alignItems:"flex-start",gap:4}}>
      <span style={{color:fg,fontSize:9,fontWeight:700,paddingTop:1,flexShrink:0,minWidth:18}}>{label}</span>
      <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
        {items.map((it,i)=>{
          const{bg,bd,fg:f}=C.chip[color]||C.chip.blue;
          return(
            <span key={i} style={{background:bg,border:`1px solid ${bd}`,borderRadius:3,
              color:f,fontSize:9,fontWeight:600,padding:"1px 4px",whiteSpace:"nowrap"}}>
              {it.qty!=null?`${it.qty}× `:""}{it.pre?`${it.pre} `:""}{it.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─── Dictionary Panel ─────────────────────────────────────────────────────────
function DictPanel({dict,types,instances,natTypes,natInstances,onAddType,onDeleteType,onEditType,onEditNatType,onDeleteNatType}){
  const[tab,setTab]=useState("types");
  const tabs=[
    {id:"types",        label:"🏠 Buildings",  count:types.length},
    {id:"natresources", label:"🌿 Resources",  count:natTypes.length},
    {id:"items",        label:"📦 Items",      count:Object.keys(dict.R).length},
    {id:"workers",      label:"👷 Workers",    count:Object.keys(dict.W).length},
  ];
  return(
    <div>
      <div style={{display:"flex",gap:2,marginBottom:8,borderBottom:`2px solid ${C.border}`,paddingBottom:4}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className="abtn"
            style={{flex:1,padding:"3px 2px",cursor:"pointer",fontSize:9,
              fontFamily:"inherit",fontWeight:tab===t.id?700:500,
              background:tab===t.id?C.btn:"transparent",
              border:tab===t.id?`1px solid ${C.btnBdr}`:"1px solid transparent",
              borderRadius:4,color:tab===t.id?C.btnTxt:C.muted}}>
            {t.label} <span style={{color:C.muted,fontSize:8}}>({t.count})</span>
          </button>
        ))}
      </div>

      {tab==="types"&&(
        <div>
          <div style={{marginBottom:6}}><Btn onClick={onAddType}>+ Define New Type</Btn></div>
          {types.length===0&&<Empty>No building types defined yet.</Empty>}
          {types.map(type=>{
            const instCount=instances.filter(i=>i.typeId===type.id).length;
            const canDel=instCount===0;
            const{Out,Del}=typeSummary(type);
            const sub=[
              Out.length>0&&`Produces: ${Out.map(r=>r.name).join(", ")}`,
              Del.length>0&&`Delivers: ${Del.map(r=>r.name).join(", ")}`,
            ].filter(Boolean).join(" · ")||"No tasks yet";
            return(
              <div key={type.id} style={{display:"flex",alignItems:"center",gap:5,
                padding:"5px 7px",borderRadius:5,marginBottom:3,
                background:C.rowBg,border:`1px solid ${C.rowBdr}`}}>
                <span style={{fontSize:17,lineHeight:1,flexShrink:0}}>{type.emoji}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:C.text,fontSize:12,fontWeight:700,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{type.name}</div>
                  <div style={{color:C.muted,fontSize:9,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>
                </div>
                <span style={{background:"#d4eaff",border:"1px solid #68a8dc",borderRadius:8,
                  color:"#083060",fontSize:9,fontWeight:700,padding:"1px 6px",
                  whiteSpace:"nowrap",flexShrink:0}}>{instCount}×</span>
                <Btn onClick={()=>onEditType(type.id)}>Edit</Btn>
                <button onClick={()=>canDel&&onDeleteType(type.id)} className="abtn"
                  title={canDel?"Delete type":"Remove all instances first"}
                  style={{...DBT,opacity:canDel?1:.35,cursor:canDel?"pointer":"not-allowed",padding:"2px 6px"}}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {tab==="natresources"&&(
        <div>
          {natTypes.length===0&&<Empty>No natural resource types defined yet.</Empty>}
          {natTypes.map(type=>{
            const instCount=natInstances.filter(i=>i.typeId===type.id).length;
            const canDel=instCount===0;
            const items=Object.entries(type.baseInventory||{});
            const sub=items.length>0
              ? `Contains: ${items.map(([r,q])=>`${q}× ${r}`).join(", ")}`
              : "No base inventory defined";
            return(
              <div key={type.id} style={{display:"flex",alignItems:"center",gap:5,
                padding:"5px 7px",borderRadius:5,marginBottom:3,
                background:"linear-gradient(180deg,#f0fbf0 0%,#e0f4e0 100%)",
                border:`1px solid ${C.natBorder}`}}>
                <span style={{fontSize:17,lineHeight:1,flexShrink:0}}>{type.emoji}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{color:"#1a3c1a",fontSize:12,fontWeight:700,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{type.name}</div>
                  <div style={{color:"#4a6a4a",fontSize:9,overflow:"hidden",
                    textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sub}</div>
                </div>
                <span style={{background:"#c8ecc8",border:`1px solid ${C.natBorder}`,borderRadius:8,
                  color:"#1a3c1a",fontSize:9,fontWeight:700,padding:"1px 6px",
                  whiteSpace:"nowrap",flexShrink:0}}>{instCount}×</span>
                <Btn onClick={()=>onEditNatType(type.id)}>Edit</Btn>
                <button onClick={()=>canDel&&onDeleteNatType(type.id)} className="abtn"
                  title={canDel?"Delete type":"Remove all instances first"}
                  style={{...DBT,opacity:canDel?1:.35,cursor:canDel?"pointer":"not-allowed",padding:"2px 6px"}}>✕</button>
              </div>
            );
          })}
        </div>
      )}

      {tab==="items"&&(
        Object.keys(dict.R).length===0
          ?<Empty>No resources defined yet.</Empty>
          :Object.entries(dict.R).sort(([a],[b])=>a.localeCompare(b)).map(([name])=>(
            <DictRow key={name} emoji="📦" name={name}/>
          ))
      )}
      {tab==="workers"&&(
        Object.keys(dict.W).length===0
          ?<Empty>No worker types defined yet.</Empty>
          :Object.entries(dict.W).sort(([a],[b])=>a.localeCompare(b)).map(([name,v])=>(
            <DictRow key={name} emoji={v.emoji} name={name}/>
          ))
      )}
    </div>
  );
}

// ─── World Status Panel ───────────────────────────────────────────────────────
function WorldStatus({types, instances, natTypes, natInstances}) {
  const buildingRows = types.map(type => ({
    type,
    count: instances.filter(i=>i.typeId===type.id).length,
  })).filter(r=>r.count>0);

  const natRows = natTypes.map(type => ({
    type,
    count: natInstances.filter(i=>i.typeId===type.id).length,
    totalInv: natInstances
      .filter(i=>i.typeId===type.id)
      .reduce((acc,i)=>{
        Object.entries(i.inventory||{}).forEach(([r,q])=>{ acc[r]=(acc[r]||0)+q; });
        return acc;
      },{}),
  })).filter(r=>r.count>0);

  // Workers: sum workerRequirements.qty * instance count, plus deliver step workers
  const workerTotals = new Map(); // name → {emoji, total}
  types.forEach(type => {
    const instCount = instances.filter(i=>i.typeId===type.id).length;
    if (instCount===0) return;
    type.workTasks.forEach(task => {
      task.workerRequirements?.forEach(wr => {
        if (!wr.workerType?.trim()) return;
        const k=wr.workerType.trim();
        const cur=workerTotals.get(k)||{emoji:wr.emoji||"👷",total:0};
        workerTotals.set(k,{...cur, total:cur.total+(wr.qty||1)*instCount});
      });
      task.steps.forEach(s => {
        if (s.stepType==="deliver") { /* worker is the task owner — no separate deliver worker */ }
      });
    });
  });

  // Resources generated per cycle: get_resource outQty + convert_resource outQty (net of inputs)
  const resTotals = new Map(); // name → total per cycle across all instances
  types.forEach(type => {
    const instCount = instances.filter(i=>i.typeId===type.id).length;
    if (instCount===0) return;
    const{Out} = typeSummary(type);
    Out.forEach(r => {
      const cur = resTotals.get(r.name)||0;
      resTotals.set(r.name, cur + r.qty*instCount);
    });
  });

  const SH = {fontSize:9,fontWeight:800,color:C.muted,letterSpacing:".08em",
    textTransform:"uppercase",marginBottom:5,marginTop:10};

  return(
    <div>
      <div style={{marginBottom:8,padding:"4px 8px",background:"#e8f4ff",
        border:"1px solid #a8d0f0",borderRadius:5,fontSize:10,color:C.muted,fontStyle:"italic"}}>
        Totals reflect all instances currently on the canvas.
      </div>

      <div style={SH}>🏠 Buildings on Canvas</div>
      {buildingRows.length===0&&<Empty>No instances placed yet.</Empty>}
      {buildingRows.map(({type,count})=>(
        <div key={type.id} style={{display:"flex",alignItems:"center",gap:8,
          padding:"4px 8px",borderRadius:5,marginBottom:3,
          background:C.rowBg,border:`1px solid ${C.rowBdr}`}}>
          <span style={{fontSize:16,flexShrink:0}}>{type.emoji}</span>
          <span style={{flex:1,fontSize:12,fontWeight:600,color:C.text}}>{type.name}</span>
          <WorldBadge val={count} unit="building"/>
        </div>
      ))}

      <div style={SH}>👷 Workers Deployed</div>
      {workerTotals.size===0&&<Empty>No workers defined on placed types.</Empty>}
      {[...workerTotals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,v])=>(
        <div key={name} style={{display:"flex",alignItems:"center",gap:8,
          padding:"4px 8px",borderRadius:5,marginBottom:3,
          background:C.rowBg,border:`1px solid ${C.rowBdr}`}}>
          <span style={{fontSize:16,flexShrink:0}}>{v.emoji}</span>
          <span style={{flex:1,fontSize:12,fontWeight:600,color:C.text}}>{name}</span>
          <WorldBadge val={v.total} unit="worker"/>
        </div>
      ))}

      <div style={SH}>📦 Resources Generated <span style={{fontSize:8,fontWeight:400}}>(per task cycle)</span></div>
      {resTotals.size===0&&<Empty>No outputs defined on placed types.</Empty>}
      {[...resTotals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,total])=>(
        <div key={name} style={{display:"flex",alignItems:"center",gap:8,
          padding:"4px 8px",borderRadius:5,marginBottom:3,
          background:C.rowBg,border:`1px solid ${C.rowBdr}`}}>
          <span style={{fontSize:16,flexShrink:0}}>📦</span>
          <span style={{flex:1,fontSize:12,fontWeight:600,color:C.text}}>{name}</span>
          <WorldBadge val={total} unit="unit"/>
        </div>
      ))}

      <div style={{...SH,color:"#2a6828"}}>🌿 Natural Resources on Canvas</div>
      {natRows.length===0&&<Empty>No natural resource instances placed.</Empty>}
      {natRows.map(({type,count,totalInv})=>(
        <div key={type.id} style={{borderRadius:5,marginBottom:4,
          background:"linear-gradient(180deg,#f0fbf0 0%,#e0f4e0 100%)",
          border:`1px solid ${C.natBorder}`,padding:"5px 8px"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:Object.keys(totalInv).length?4:0}}>
            <span style={{fontSize:16,flexShrink:0}}>{type.emoji}</span>
            <span style={{flex:1,fontSize:12,fontWeight:600,color:"#1a3c1a"}}>{type.name}</span>
            <span style={{background:"#c8ecc8",border:`1px solid ${C.natBorder}`,borderRadius:8,
              color:"#1a3c1a",fontSize:9,fontWeight:700,padding:"1px 6px",
              whiteSpace:"nowrap",flexShrink:0}}>{count}×</span>
          </div>
          {Object.keys(totalInv).length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:3,paddingLeft:24}}>
              {Object.entries(totalInv).sort(([a],[b])=>a.localeCompare(b)).map(([r,q])=>(
                <span key={r} style={{background:"#d8f5d8",border:`1px solid ${C.natBorder}`,
                  borderRadius:3,color:"#1a3c1a",fontSize:9,fontWeight:600,
                  padding:"1px 5px",whiteSpace:"nowrap"}}>{q}× {r}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function WorldBadge({val,unit}){
  return(
    <span style={{background:"#d4eaff",border:"1px solid #68a8dc",borderRadius:8,
      color:"#083060",fontSize:9,fontWeight:700,padding:"1px 8px",
      whiteSpace:"nowrap",flexShrink:0}}>
      {val} {unit}{val!==1?"s":""}
    </span>
  );
}

// ─── Natural Resource Card ────────────────────────────────────────────────────
function NatResourceCard({instance, type, label, isSelected, onHeight, onDoubleClick}){
  const cardRef=useRef(null);
  useEffect(()=>{
    if(!cardRef.current||!onHeight)return;
    const ro=new ResizeObserver(([e])=>onHeight(e.target.offsetHeight));
    ro.observe(cardRef.current);
    return()=>ro.disconnect();
  },[onHeight]);

  const invEntries = Object.entries(instance.inventory||{});
  const borderColor = isSelected ? "#2a7028" : C.natBorder;
  const bgColor     = isSelected ? "#e0f8e0" : C.natBg;
  const shadow = isSelected
    ? "0 0 0 2.5px #2a702860,0 4px 20px rgba(0,100,0,.2)"
    : "0 2px 12px rgba(0,60,0,.12),inset 0 0 0 1px rgba(255,255,255,.7)";

  return(
    <div ref={cardRef} data-nid={instance.id}
      onDoubleClick={e=>{e.stopPropagation();onDoubleClick();}}
      style={{position:"absolute",left:instance.x,top:instance.y,
        width:BW,minHeight:BH_BASE,background:bgColor,
        border:`2px solid ${borderColor}`,borderRadius:10,
        cursor:"default",userSelect:"none",overflow:"visible",touchAction:"none",
        boxShadow:shadow,transition:"border-color .1s,box-shadow .1s,background .12s"}}>
      <div style={{
        background:isSelected?C.natTopSel:C.natTop,
        padding:"6px 10px",borderRadius:"8px 8px 0 0",display:"flex",alignItems:"center",gap:7}}>
        <span style={{fontSize:20,lineHeight:1,flexShrink:0}}>{type.emoji}</span>
        <span style={{color:"#fff",fontSize:12,fontWeight:700,flex:1,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
          textShadow:"0 1px 2px rgba(0,0,0,.4)"}}>{label}</span>
        <span style={{color:"rgba(255,255,255,.8)",fontSize:9,flexShrink:0,fontWeight:600,
          background:"rgba(0,0,0,.15)",borderRadius:3,padding:"1px 5px"}}>🌿 NAT</span>
      </div>
      <div style={{padding:"5px 8px 6px",display:"flex",flexDirection:"column",gap:3}}>
        {invEntries.length===0?(
          <span style={{color:"#4a6a4a",fontSize:9,fontStyle:"italic",padding:"2px 0"}}>
            Empty inventory — double-click to configure type
          </span>
        ):(
          <ChipRow label="📦"
            items={invEntries.map(([name,qty])=>({name,qty}))}
            color="teal"/>
        )}
      </div>
    </div>
  );
}

// ─── Natural Resource Editor ──────────────────────────────────────────────────
function NatResourceEditor({natType, allR, onChange}){
  const up = patch => onChange({...natType,...patch});

  const baseInv = natType.baseInventory || {};
  const rows = Object.entries(baseInv);

  const setRow = (oldKey, newKey, qty) => {
    const next = {};
    rows.forEach(([k,v])=>{
      const useKey = k===oldKey ? (newKey||k) : k;
      if (!next[useKey]) next[useKey] = (k===oldKey ? qty : v);
    });
    up({baseInventory:next});
  };

  const addRow = () => {
    let name="Resource", n=1;
    while (baseInv[name]) name=`Resource ${n++}`;
    up({baseInventory:{...baseInv,[name]:1}});
  };

  const delRow = key => {
    const next={...baseInv};
    delete next[key];
    up({baseInventory:next});
  };

  return(
    <div>
      <div style={{marginBottom:8,padding:"4px 8px",
        background:"#e4f8e4",border:`1px solid ${C.natBorder}`,
        borderRadius:5,fontSize:10,color:"#2a4a2a",fontStyle:"italic"}}>
        Changes here update all placed instances of this resource type immediately.
      </div>

      <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
        <EmojiPicker value={natType.emoji} onChange={v=>up({emoji:v})}/>
        <input value={natType.name} onChange={e=>up({name:e.target.value})}
          placeholder="Resource type name" data-ix="1"
          style={{...IST,flex:1,fontSize:13,fontWeight:700}}/>
      </div>

      <SectionLabel right={<Btn onClick={addRow}>+ Add Resource</Btn>}>
        Base Inventory ({rows.length} resource{rows.length!==1?"s":""})
      </SectionLabel>

      {rows.length===0&&<Empty>No resources defined. Add one above.</Empty>}

      <div style={{background:"linear-gradient(180deg,#edf8ed 0%,#dff2df 100%)",
        border:`1px solid ${C.natBorder}`,borderRadius:7,
        padding:rows.length?8:0,marginBottom:rows.length?8:0}}>
        {rows.map(([key, qty])=>(
          <div key={key} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center",
            background:"linear-gradient(180deg,#f4fbf4 0%,#eaf5ea 100%)",
            border:`1px solid #88c888`,borderRadius:5,padding:"4px 6px"}}>
            <Combo value={key}
              onChange={v=>setRow(key, v, qty)}
              opts={allR} placeholder="Resource name"/>
            <NumInput v={qty} onChange={v=>setRow(key,key,v)}/>
            <Btn danger onClick={()=>delRow(key)}>✕</Btn>
          </div>
        ))}
      </div>
    </div>
  );
}

function DictRow({emoji,name,badge}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 7px",
      borderRadius:5,marginBottom:3,background:C.rowBg,border:`1px solid ${C.rowBdr}`}}>
      <span style={{fontSize:17,lineHeight:1,flexShrink:0}}>{emoji}</span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{color:C.text,fontSize:12,fontWeight:700,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
      </div>
      {badge&&(
        <span style={{background:"#d4eaff",border:"1px solid #68a8dc",borderRadius:8,
          color:"#083060",fontSize:9,fontWeight:700,padding:"1px 7px",flexShrink:0}}>{badge}</span>
      )}
    </div>
  );
}

// ─── Building Type Editor ─────────────────────────────────────────────────────
function BuildingEditor({building,dict,types,instances,natTypes,natInstances,dragHint,onClearHint,onChange}){
  const allR=Object.keys(dict.R), allW=Object.keys(dict.W);
  const up     = patch => onChange({...building,...patch});
  const upTask = (tid,patch) => up({workTasks:building.workTasks.map(t=>t.id===tid?{...t,...patch}:t)});
  const addTask = ()=>up({workTasks:[...building.workTasks,{id:nt(),name:"New Task",workerRequirements:[],steps:[]}]});
  const delTask = id=>up({workTasks:building.workTasks.filter(t=>t.id!==id)});

  const addStep=tId=>{
    const task=building.workTasks.find(t=>t.id===tId);
    upTask(tId,{steps:[...task.steps,{id:ns(),name:"New Step",stepType:"get_resource",time:5,outResource:"",outQty:1,sourceType:"nearest",sourceNatInstanceId:null}]});
  };
  const upStep=(tId,sId,patch)=>{
    const task=building.workTasks.find(t=>t.id===tId);
    upTask(tId,{steps:task.steps.map(s=>s.id===sId?{...s,...patch}:s)});
  };
  const delStep=(tId,sId)=>{
    const task=building.workTasks.find(t=>t.id===tId);
    upTask(tId,{steps:task.steps.filter(s=>s.id!==sId)});
  };
  const addWR=tId=>{
    const task=building.workTasks.find(t=>t.id===tId);
    upTask(tId,{workerRequirements:[...task.workerRequirements,{workerType:"",qty:1,emoji:"👷"}]});
  };
  const upWR=(tId,i,patch)=>{
    const task=building.workTasks.find(t=>t.id===tId);
    upTask(tId,{workerRequirements:task.workerRequirements.map((w,j)=>j===i?{...w,...patch}:w)});
  };
  const delWR=(tId,i)=>{
    const task=building.workTasks.find(t=>t.id===tId);
    upTask(tId,{workerRequirements:task.workerRequirements.filter((_,j)=>j!==i)});
  };

  return(
    <div>
      {/* Drag-to-connect hint banner */}
      {dragHint&&(
        <div style={{marginBottom:8,padding:"6px 10px",background:"#fff8e4",
          border:"1px solid #d8b050",borderRadius:5,display:"flex",
          alignItems:"center",gap:8,fontSize:10,color:"#5c3800"}}>
          <span style={{flex:1}}>
            💡 You dragged toward a <strong>{dragHint.toTypeName}</strong>. Add a <strong>Deliver</strong> step to a task to route resources there.
          </span>
          <button onClick={onClearHint} style={{...SBT,padding:"1px 6px",fontSize:9}}>✕</button>
        </div>
      )}

      <div style={{marginBottom:8,padding:"4px 8px",background:"#e8f4ff",
        border:"1px solid #a8d0f0",borderRadius:5,fontSize:10,color:C.muted,fontStyle:"italic"}}>
        Changes here apply to all instances of this type on the canvas.
      </div>

      <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
        <EmojiPicker value={building.emoji} onChange={v=>up({emoji:v})}/>
        <input value={building.name} onChange={e=>up({name:e.target.value})}
          placeholder="Type name" data-ix="1"
          style={{...IST,flex:1,fontSize:13,fontWeight:700}}/>
      </div>

      <SectionLabel right={<Btn onClick={addTask}>+ Task</Btn>}>
        Work Tasks ({building.workTasks.length})
      </SectionLabel>
      {building.workTasks.length===0&&<Empty>No tasks yet.</Empty>}

      {building.workTasks.map(task=>(
        <div key={task.id} style={{background:"linear-gradient(180deg,#eef6ff 0%,#e2eefc 100%)",
          border:"1px solid #aacce8",borderRadius:7,padding:8,marginBottom:8}}>
          <div style={{display:"flex",gap:5,marginBottom:6,alignItems:"center"}}>
            <input value={task.name} onChange={e=>upTask(task.id,{name:e.target.value})}
              placeholder="Task name" data-ix="1"
              style={{...IST,flex:1,fontWeight:600,fontSize:12}}/>
            <Btn danger onClick={()=>delTask(task.id)}>✕</Btn>
          </div>

          <SectionLabel right={<Btn onClick={()=>addWR(task.id)}>+ Add</Btn>}>
            Workers Required
          </SectionLabel>
          {task.workerRequirements.length===0&&
            <div style={{color:C.muted,fontSize:10,fontStyle:"italic",marginBottom:4}}>None</div>}
          {task.workerRequirements.map((wr,i)=>(
            <div key={i} style={{display:"flex",gap:4,marginBottom:4,alignItems:"center"}}>
              <EmojiPicker value={wr.emoji||"👷"} onChange={v=>upWR(task.id,i,{emoji:v})}/>
              <Combo value={wr.workerType||""} onChange={v=>upWR(task.id,i,{workerType:v})}
                opts={allW} placeholder="Worker type…"/>
              <NumInput v={wr.qty||1} onChange={v=>upWR(task.id,i,{qty:v})}/>
              <Btn danger onClick={()=>delWR(task.id,i)}>✕</Btn>
            </div>
          ))}

          <SectionLabel right={<Btn onClick={()=>addStep(task.id)}>+ Step</Btn>}>
            Steps ({task.steps.length})
          </SectionLabel>
          {task.steps.length===0&&
            <div style={{color:C.muted,fontSize:10,fontStyle:"italic"}}>No steps yet.</div>}
          {task.steps.map(s=>(
            <StepEditor key={s.id} step={s} allR={allR}
              types={types} instances={instances}
              natTypes={natTypes} natInstances={natInstances}
              onChange={p=>upStep(task.id,s.id,p)}
              onRemove={()=>delStep(task.id,s.id)}/>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Step Editor ──────────────────────────────────────────────────────────────
function StepEditor({step,allR,types,instances,natTypes,natInstances,onChange,onRemove}){
  return(
    <div style={{background:STEP_BG[step.stepType]||"#f0f8ff",
      border:`1px solid ${STEP_BD[step.stepType]||"#b0ccee"}`,
      borderRadius:5,padding:6,marginBottom:4}}>

      {/* Header row */}
      <div style={{display:"flex",gap:3,marginBottom:4,alignItems:"center"}}>
        <input value={step.name} onChange={e=>onChange({name:e.target.value})}
          placeholder="Step name" data-ix="1" style={{...IST,flex:1,fontSize:10}}/>
        <select value={step.stepType} onChange={e=>onChange({stepType:e.target.value})}
          data-ix="1" style={{...IST,width:82,fontSize:10,padding:"3px 2px",cursor:"pointer",flexShrink:0}}>
          {STEP_TYPES.map(t=><option key={t} value={t}>{STEP_LABELS[t]}</option>)}
        </select>
        {step.stepType!=="deliver"&&(
          <NumInput v={step.time||1} onChange={v=>onChange({time:v})} title="Seconds" width={44}/>
        )}
        <Btn danger onClick={onRemove}>✕</Btn>
      </div>

      {/* Gather */}
      {step.stepType==="get_resource"&&(
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {/* Resource + qty */}
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <MLabel>GATHER</MLabel>
            <Combo value={step.outResource||""} onChange={v=>onChange({outResource:v})} opts={allR} placeholder="Resource"/>
            <NumInput v={step.outQty||1} onChange={v=>onChange({outQty:v})}/>
          </div>
          {/* Source nat resource */}
          <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
            <MLabel>FROM</MLabel>
            <select value={step.sourceType||"nearest"}
              onChange={e=>onChange({sourceType:e.target.value, sourceNatInstanceId:null})}
              data-ix="1"
              style={{...IST,width:82,fontSize:10,padding:"3px 2px",cursor:"pointer",flexShrink:0}}>
              <option value="nearest">Nearest</option>
              <option value="specified">Specified</option>
            </select>
            {/* Nearest: auto-resolved at sim time — just show info */}
            {(step.sourceType||"nearest")==="nearest"&&(
              <span style={{fontSize:9,color:C.muted,fontStyle:"italic",flex:1}}>
                nearest node with {step.outResource||"this resource"} in inventory
              </span>
            )}
            {/* Specified: pick exact nat instance */}
            {step.sourceType==="specified"&&(
              <select value={step.sourceNatInstanceId||""}
                onChange={e=>onChange({sourceNatInstanceId:parseInt(e.target.value)||null})}
                data-ix="1"
                style={{...IST,flex:1,fontSize:10,padding:"3px 2px",cursor:"pointer"}}>
                <option value="">— resource node —</option>
                {natInstances
                  .filter(i=>{
                    if (!step.outResource?.trim()) return true;
                    return (i.inventory||{})[step.outResource.trim()] > 0;
                  })
                  .map(i=>{
                    const t=natTypes.find(t=>t.id===i.typeId);
                    const peers=natInstances.filter(x=>x.typeId===i.typeId);
                    const lbl=peers.length===1?t?.name:`${t?.name} #${peers.findIndex(x=>x.id===i.id)+1}`;
                    return <option key={i.id} value={i.id}>{t?.emoji} {lbl}</option>;
                  })}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Convert */}
      {step.stepType==="convert_resource"&&(
        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          <MLabel>IN</MLabel>
          <Combo value={step.inResource||""} onChange={v=>onChange({inResource:v})} opts={allR} placeholder="Resource"/>
          <NumInput v={step.inQty||1} onChange={v=>onChange({inQty:v})}/>
          <MLabel>→ OUT</MLabel>
          <Combo value={step.outResource||""} onChange={v=>onChange({outResource:v})} opts={allR} placeholder="Resource"/>
          <NumInput v={step.outQty||1} onChange={v=>onChange({outQty:v})}/>
        </div>
      )}

      {/* Deliver */}
      {step.stepType==="deliver"&&(
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {/* Resource + qty */}
          <div style={{display:"flex",gap:4,alignItems:"center"}}>
            <MLabel>CARRY</MLabel>
            <Combo value={step.resource||""} onChange={v=>onChange({resource:v})} opts={allR} placeholder="Resource"/>
            <NumInput v={step.qty||1} onChange={v=>onChange({qty:v})}/>
          </div>
          {/* Destination */}
          <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
            <MLabel>TO</MLabel>
            <select value={step.destinationType||"nearest"}
              onChange={e=>onChange({destinationType:e.target.value, destinationInstanceId:null})}
              data-ix="1"
              style={{...IST,width:82,fontSize:10,padding:"3px 2px",cursor:"pointer",flexShrink:0}}>
              <option value="nearest">Nearest</option>
              <option value="specified">Specified</option>
            </select>
            {/* Nearest: pick destination type */}
            {(step.destinationType||"nearest")==="nearest"&&(
              <select value={step.destinationTypeId||""}
                onChange={e=>onChange({destinationTypeId:parseInt(e.target.value)||null})}
                data-ix="1"
                style={{...IST,flex:1,fontSize:10,padding:"3px 2px",cursor:"pointer"}}>
                <option value="">— building type —</option>
                {types.map(t=><option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
              </select>
            )}
            {/* Specified: pick exact instance */}
            {step.destinationType==="specified"&&(
              <select value={step.destinationInstanceId||""}
                onChange={e=>onChange({destinationInstanceId:parseInt(e.target.value)||null})}
                data-ix="1"
                style={{...IST,flex:1,fontSize:10,padding:"3px 2px",cursor:"pointer"}}>
                <option value="">— instance —</option>
                {instances
                  .filter(i=>step.destinationTypeId?i.typeId===step.destinationTypeId:true)
                  .map(i=>{
                    const t=types.find(t=>t.id===i.typeId);
                    const peers=instances.filter(x=>x.typeId===i.typeId);
                    const lbl=peers.length===1?t?.name:`${t?.name} #${peers.findIndex(x=>x.id===i.id)+1}`;
                    return <option key={i.id} value={i.id}>{t?.emoji} {lbl}</option>;
                  })}
              </select>
            )}
          </div>
        </div>
      )}

      {/* Flavor text */}
      {step.stepType==="flavor_text"&&(
        <input value={step.text||""} onChange={e=>onChange({text:e.target.value})}
          placeholder="Flavor text shown during this step…" data-ix="1"
          style={{...IST,fontSize:10}}/>
      )}
    </div>
  );
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
const COMMON_EMOJI = ["🏠","🏭","⚙️","🏗️","🌾","🍺","🏨","🍞","⚒️","🧱","🪵","🔨",
  "🌲","🐄","🐖","🐑","🧑‍🌾","👷","⚗️","🍻","💁","🚶","🏇","⛏️","🪙","💰","📦",
  "🥩","🧀","🥛","🍷","🌽","🐟","🔥","⚡","💧","🧲","🪨","🛒","🎭","🏰","⚔️"];

function EmojiPicker({value,onChange}){
  const[open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown",fn);
    return()=>document.removeEventListener("pointerdown",fn);
  },[open]);
  return(
    <div ref={ref} style={{position:"relative",flexShrink:0}}>
      <button onClick={()=>setOpen(o=>!o)} data-ix="1" className="abtn"
        style={{...SBT,width:34,height:28,fontSize:16,padding:0,textAlign:"center"}}>
        {value||"❓"}
      </button>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:9999,
          background:"#fff",border:"1px solid #90c0e0",borderRadius:8,padding:6,
          boxShadow:"0 4px 20px rgba(0,60,140,.2)",
          display:"grid",gridTemplateColumns:"repeat(8,28px)",gap:2,width:252}}>
          {COMMON_EMOJI.map(e=>(
            <button key={e} onClick={()=>{onChange(e);setOpen(false);}} data-ix="1"
              style={{width:28,height:28,fontSize:16,border:"1px solid transparent",
                borderRadius:4,background:"transparent",cursor:"pointer",
                textAlign:"center",padding:0,lineHeight:"28px"}}
              onMouseEnter={ev=>ev.target.style.background="#d4eaff"}
              onMouseLeave={ev=>ev.target.style.background="transparent"}>{e}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Combo ────────────────────────────────────────────────────────────────────
function Combo({value,onChange,opts,placeholder}){
  const [draft,  setDraft]  = useState(value||"");
  const [open,   setOpen]   = useState(false);

  // Keep draft in sync when the parent value changes from outside
  // (e.g. when a dropdown pick in a sibling row triggers re-render)
  const prev = useRef(value);
  if (prev.current !== value) { prev.current = value; setDraft(value||""); }

  const filtered = opts.filter(o=>o.toLowerCase().includes(draft.toLowerCase()));

  const commit = v => { onChange(v); setDraft(v); };

  return(
    <div style={{position:"relative",flex:1,minWidth:0}}>
      <input value={draft}
        onChange={e=>{ setDraft(e.target.value); setOpen(true); }}
        onKeyDown={e=>{ if(e.key==="Enter"){ commit(draft); setOpen(false); e.target.blur(); } }}
        onBlur={()=>{ commit(draft); setTimeout(()=>setOpen(false),160); }}
        onFocus={()=>setOpen(true)}
        placeholder={placeholder} data-ix="1" style={IST}
        onClick={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}/>
      {open&&filtered.length>0&&(
        <div style={{position:"absolute",top:"calc(100% + 2px)",left:0,zIndex:9999,
          background:C.white,border:"1px solid #90c0e0",borderRadius:5,
          boxShadow:"0 4px 18px rgba(0,60,140,.18)",minWidth:"100%",
          maxHeight:120,overflowY:"auto"}}>
          {filtered.map(o=>(
            <div key={o} className="drop-row"
              onMouseDown={e=>{ e.preventDefault(); commit(o); setOpen(false); }}
              style={{padding:"4px 8px",fontSize:11,color:C.text,cursor:"pointer",
                background:"transparent",transition:"background .1s"}}>{o}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Micro components ─────────────────────────────────────────────────────────
function SectionLabel({children,right}){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
      marginBottom:4,marginTop:2}}>
      <span style={{color:C.muted,fontSize:9,fontWeight:700,letterSpacing:".08em",
        textTransform:"uppercase"}}>{children}</span>
      {right}
    </div>
  );
}
function MLabel({children}){
  return(<span style={{color:C.muted,fontSize:9,fontWeight:700,flexShrink:0}}>{children}</span>);
}
function NumInput({v,onChange,title,width=40}){
  const [draft, setDraft] = useState(String(v));
  const prev = useRef(v);
  if (prev.current !== v) { prev.current = v; setDraft(String(v)); }
  const commit = raw => { const n=parseInt(raw)||1; onChange(n); setDraft(String(n)); };
  return(
    <input type="number" min={1} value={draft}
      onChange={e=>setDraft(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"){ commit(draft); e.target.blur(); } }}
      onBlur={()=>commit(draft)}
      data-ix="1" title={title}
      style={{...IST,width,textAlign:"center",fontSize:10,padding:"3px 2px",flexShrink:0}}/>
  );
}
function Btn({onClick,danger,children,style={}}){
  return(
    <button onClick={onClick} className="abtn"
      style={{...(danger?DBT:SBT),...style}}>{children}</button>
  );
}
function Empty({children}){
  return(
    <div style={{color:C.muted,fontSize:11,fontStyle:"italic",
      textAlign:"center",padding:"6px 4px"}}>{children}</div>
  );
}
function TDiv(){
  return(<div style={{width:1,height:18,background:"#a0c4e4",flexShrink:0}}/>);
}
function TBtn({active,danger,onClick,children}){
  return(
    <button onClick={onClick} className="abtn" style={{
      background:danger?"linear-gradient(180deg,#ffe0e0 0%,#f8b8b8 100%)":
        active?"linear-gradient(180deg,#a8d8ff 0%,#68aaee 100%)":C.btn,
      border:`1px solid ${danger?"#cc7070":active?"#3880c8":C.btnBdr}`,
      borderRadius:5,color:danger?"#800000":active?"#002060":C.btnTxt,
      padding:"3px 10px",cursor:"pointer",fontSize:11,
      fontFamily:"inherit",fontWeight:active?700:500,
      boxShadow:"inset 0 1px 0 rgba(255,255,255,.8)",
      minHeight:28,whiteSpace:"nowrap",
    }}>{children}</button>
  );
}
