const projects=[
 {title:"Wiki Spy",desc:"A curious little collection of things worth discovering.",cat:"Game",className:"wiki",font:"serif",fg:"#111",href:"#"},
 {title:"Cursor Camp",desc:"A tiny creative game for messing around with your cursor.",cat:"Game",className:"camp",font:"sans",fg:"#111",href:"#"},
 {title:"Sandboxels",desc:"A playful sandbox where everything interacts with everything.",cat:"Sandbox",className:"sandbox",font:"mono",fg:"#fff",href:"#"},
 {title:"Constellation Draw",desc:"Connect points and turn a blank sky into your own constellations.",cat:"Creative",className:"constellation",font:"sans",fg:"#fff",href:"#"},
 {title:"Size of Life",desc:"Explore a strange journey through the scales of the world.",cat:"Experiment",className:"life",font:"serif",fg:"#111",href:"#"},
 {title:"I'm Not a Robot",desc:"A suspiciously simple test of whether you are, in fact, human.",cat:"Puzzle",className:"robot",font:"bold",fg:"#111",href:"#"},
 {title:"Internet Roadtrip",desc:"Go somewhere. Click around. See what the internet has to offer.",cat:"Adventure",className:"road",font:"bold",fg:"#fff",href:"#"},
 {title:"Stimulation Clicker",desc:"Click things, upgrade things, and continue clicking things.",cat:"Idle",className:"clicker",font:"play",fg:"#fff",href:"#"},
 {title:"Infinite Craft",desc:"Combine ideas and discover increasingly ridiculous creations.",cat:"Sandbox",className:"craft",font:"sans",fg:"#111",href:"#"},
 {title:"Internet Artifacts",desc:"A tiny museum of strange, forgotten pieces of the web.",cat:"Archive",className:"artifacts",font:"serif",fg:"#111",href:"#"},
 {title:"The Password Game",desc:"A password that becomes increasingly unreasonable.",cat:"Puzzle",className:"password",font:"mono",fg:"#111",href:"#"},
 {title:"Space Elevator",desc:"Build upward and find out how far you can go.",cat:"Experiment",className:"space",font:"bold",fg:"#111",href:"#"}
];

const grid=document.querySelector("#grid"),filters=document.querySelector("#filters");
const empty=document.querySelector("#empty");
let active="All";

const categories=["All",...new Set(projects.map(p=>p.cat))];
categories.forEach(cat=>{
 const b=document.createElement("button");
 b.className="filter"+(cat==="All"?" active":"");
 b.textContent=cat;
 b.onclick=()=>{active=cat;document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");render()};
 filters.appendChild(b);
});

function filtered(){
 return active==="All"?projects:projects.filter(p=>p.cat===active);
}
function render(list=filtered()){
 grid.innerHTML="";
 empty.hidden=list.length>0;
 list.forEach((p,i)=>{
   const a=document.createElement("a");
   a.className=`card ${p.className}`;
   a.href=p.href;
   a.dataset.font=p.font;
   a.style.setProperty("--card-fg",p.fg);
   a.style.setProperty("--tilt",`${i%2?-0.18:0.18}deg`);
   a.style.animationDelay=`${Math.min(i*35,350)}ms`;
   a.innerHTML=`<div class="art"></div><span class="badge">${p.cat}</span><button class="fav" aria-label="Favorite ${p.title}" type="button">♡</button><div class="card-content"><div class="title">${p.title}<span class="subtitle">${p.desc}</span></div></div>`;
   const fav=a.querySelector(".fav");
   if(localStorage.getItem("fav:"+p.title)==="1"){fav.textContent="♥";fav.classList.add("active")}
   fav.onclick=e=>{e.preventDefault();e.stopPropagation();const on=fav.classList.toggle("active");fav.textContent=on?"♥":"♡";localStorage.setItem("fav:"+p.title,on?"1":"0")};
   grid.appendChild(a);
 });
}
document.querySelector("#shuffle").onclick=()=>render([...filtered()].sort(()=>Math.random()-.5));
document.querySelector("#theme").onclick=()=>{
 document.body.classList.toggle("dark");
 localStorage.setItem("theme",document.body.classList.contains("dark")?"dark":"light");
};
if(localStorage.getItem("theme")==="dark")document.body.classList.add("dark");
document.querySelector("#year").textContent=new Date().getFullYear();
render();
