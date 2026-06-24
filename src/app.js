/* AST Orbital Tracker — standalone build (no React / no DC runtime).
   Real Celestrak element snapshot baked at build time + real SGP4 propagation.
   THREE, THREE.OrbitControls, satellite are provided by inlined libraries above. */
(function(){
  "use strict";
  var LIVE_TLES = /*__LIVE_TLES__*/ {};
  var TEX = /*__TEX__*/ {};

  function byId(id){ return document.getElementById(id); }

  var A = {
    dom: {},
    satObjs: [], plannedObjs: [], showPlanned: true, selectedId: null,
    ease: { active:false }, listOpen: true,
    ER: 1, KM: 1/6371, baseEpoch: '25237.69429158',

    // Verified against Celestrak catalog + AST SpaceMobile / news sources (June 2026).
    // id = real NORAD catalog number; lost sats carry no orbit and are not plotted.
    fleet: [
      {id:'53807', norad:'53807', name:'BlueWalker 3', block:'PROTOTYPE', launch:'2022-09-10', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'61047', norad:'61047', name:'BlueBird 1',  block:'BLOCK 1', launch:'2024-09-12', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'61048', norad:'61048', name:'BlueBird 2',  block:'BLOCK 1', launch:'2024-09-12', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'61045', norad:'61045', name:'BlueBird 3',  block:'BLOCK 1', launch:'2024-09-12', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'61049', norad:'61049', name:'BlueBird 4',  block:'BLOCK 1', launch:'2024-09-12', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'61046', norad:'61046', name:'BlueBird 5',  block:'BLOCK 1', launch:'2024-09-12', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'67232', norad:'67232', name:'BlueBird 6',  block:'BLOCK 2', launch:'2025-12-24', rocket:'ISRO LVM3', site:'Sriharikota, IN', status:'online'},
      {id:'lost-bb7', norad:'—', name:'BlueBird 7', block:'BLOCK 2', launch:'2026-04-19', rocket:'New Glenn', site:'Cape Canaveral, FL', status:'lost', note:'New Glenn 2nd-stage anomaly — off-nominal orbit'},
      {id:'69589', norad:'69589', name:'BlueBird 8',  block:'BLOCK 2', launch:'2026-06-17', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'69590', norad:'69590', name:'BlueBird 9',  block:'BLOCK 2', launch:'2026-06-17', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'},
      {id:'69591', norad:'69591', name:'BlueBird 10', block:'BLOCK 2', launch:'2026-06-17', rocket:'Falcon 9', site:'Cape Canaveral, FL', status:'online'}
    ],

    init: function(){
      window.__app = this;
      var refs = ['mountRef','refClock','refDate','refSrc','refSrcDot','refOpCount','refPlannedToggle',
        'refAlt','refVel','refInc','refPer','refGeo','refCov','refPass','refPassBox','refRegion','refChips',
        'refLoad','refLocDot','refLocLabel','refLocSub','chevron','listBody','selPanel','fleetRows',
        'refLaunch','refRocket','refSite','refStatus','locManual','locInput'];
      for(var i=0;i<refs.length;i++) this.dom[refs[i]] = byId(refs[i]);
      var self=this;
      byId('toggleList').addEventListener('click', function(){ self.toggleList(); });
      byId('plannedRow').addEventListener('click', function(){ self.onTogglePlanned(); });
      byId('locateBtn').addEventListener('click', function(){ self.locateMe(false); });
      byId('deselectBtn').addEventListener('click', function(){ self.deselect(); });
      var li=byId('locInput');
      if(li){ li.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); self.submitManual(); } }); li.addEventListener('click', function(e){ e.stopPropagation(); }); }
      this.startClock();
      this.boot();
    },

    startClock: function(){
      var self=this;
      var p=function(n){ return String(n).padStart(2,'0'); };
      var upd=function(){
        var d=new Date();
        if(self.dom.refClock) self.dom.refClock.textContent = p(d.getUTCHours())+':'+p(d.getUTCMinutes())+':'+p(d.getUTCSeconds())+' UTC';
        if(self.dom.refDate) self.dom.refDate.textContent = d.toUTCString().slice(5,16).toUpperCase();
        if(self.passTarget && self.dom.refPass){
          var left=Math.round((self.passTarget-Date.now())/1000);
          if(left>0){ var m=Math.floor(left/60),s=left%60; self.dom.refPass.textContent='T- '+p(m)+':'+p(s)+'  (max el '+self.passEl+'°)'; }
          else self.dom.refPass.textContent='OVERHEAD NOW';
        }
      };
      upd(); this._clk=setInterval(upd,1000);
    },

    boot: function(){
      var self=this;
      var setLoad=function(t){ if(self.dom.refLoad) self.dom.refLoad.textContent=t; };
      try{
        setLoad('BUILDING EARTH');
        this.initScene();
        setLoad('LOADING ELEMENT SETS');
        this.loadElements();
        this.buildSats();
        this.buildPlanned();
        this.buildHud3d();
        this.animate();
        byId('loading').style.display='none';
        this.locateMe(true);
      }catch(e){
        window.__bootErr=(e&&e.stack)||String(e);
        console.error('boot failed',e);
        setLoad('ENGINE ERROR — '+(e&&e.message||e));
      }
    },

    // ---------- ELEMENTS ----------
    buildTLE: function(id, raan, ma, inc, mm){
      var f=function(v,w,d){ var s=v.toFixed(d); while(s.length<w) s=' '+s; return s; };
      var cid=String(id).padStart(5,'0');
      var l1='1 '+cid+'U 24163B   '+this.baseEpoch+'  .00002476  00000-0  12641-3 0  9990';
      var l2='2 '+cid+' '+f(inc,8,4)+' '+f(raan,8,4)+' 0010081 317.8791 '+f(ma,8,4)+' '+mm.toFixed(8)+' 52790';
      return [l1,l2];
    },
    loadElements: function(){
      var live=0, online=0;
      for(var i=0;i<this.fleet.length;i++){
        var f=this.fleet[i];
        if(f.status==='lost'){ f.statusText='LOST'; f.statusColor='#ff5a6a'; continue; }
        online++;
        if(LIVE_TLES[f.id]){ f._tle=LIVE_TLES[f.id]; f._live=true; live++; f.statusText='LIVE'; f.statusColor='#7CFFCB'; }
        else { f._live=false; f.statusText='NO DATA'; f.statusColor='#ffd24f'; }
      }
      this._live=live;
      this.renderFleet();
      if(this.dom.refSrc) this.dom.refSrc.textContent = live>=online? 'LIVE · CELESTRAK ('+live+'/'+online+')' : 'PARTIAL LIVE ('+live+'/'+online+')';
      if(this.dom.refSrcDot){ var col= live>=online? '#7CFFCB' : '#ffd24f'; this.dom.refSrcDot.style.background=col; this.dom.refSrcDot.style.boxShadow='0 0 8px '+col; if(live>=online) this.dom.refSrcDot.style.animation='none'; }
    },
    renderFleet: function(){
      var self=this, box=this.dom.fleetRows; if(!box) return; box.innerHTML='';
      this.fleet.forEach(function(s){
        var row=document.createElement('div');
        row.className='fleet-row'; row.setAttribute('data-id',s.id);
        row.innerHTML =
          '<div style="width:7px;height:7px;border-radius:50%;background:'+s.statusColor+';box-shadow:0 0 8px '+s.statusColor+';flex:none;"></div>'+
          '<div style="flex:1;min-width:0;">'+
            '<div style="font-size:12.5px;font-weight:600;color:#eaf4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.01em;text-shadow:0 1px 5px rgba(0,0,0,.7);">'+s.name+'</div>'+
            '<div style="font-family:var(--mono);font-size:8.5px;color:#86a6c6;letter-spacing:.06em;text-shadow:0 1px 4px rgba(0,0,0,.6);">'+s.norad+' · '+s.block+'</div>'+
          '</div>'+
          '<div style="font-family:var(--mono);font-size:7.5px;letter-spacing:.12em;color:'+s.statusColor+';border:1px solid '+s.statusColor+';opacity:.9;padding:1.5px 4px;clip-path:polygon(0 0,100% 0,100% 70%,calc(100% - 4px) 100%,0 100%);text-shadow:0 1px 4px rgba(0,0,0,.6);">'+s.statusText+'</div>';
        if(s.status==='lost') row.style.opacity='.62';
        row.addEventListener('click', function(){ if(s.status==='lost') self.showLost(s); else self.select(s.id); });
        box.appendChild(row);
      });
    },

    // ---------- SCENE ----------
    initScene: function(){
      var self=this;
      var mount=this.dom.mountRef; var W=mount.clientWidth||innerWidth, H=mount.clientHeight||innerHeight;
      var scene=new THREE.Scene(); this.scene=scene;
      var cam=new THREE.PerspectiveCamera(42, W/H, 0.01, 200); cam.position.set(2.0,1.25,2.7); this.cam=cam; this.defaultCam=cam.position.clone();
      var rnd=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true}); rnd.setSize(W,H); rnd.setPixelRatio(Math.min(devicePixelRatio,2)); mount.appendChild(rnd.domElement); this.renderer=rnd;
      this.raycaster=new THREE.Raycaster();

      var ctrl=new THREE.OrbitControls(cam,rnd.domElement); ctrl.enableDamping=true; ctrl.dampingFactor=.06; ctrl.rotateSpeed=.5; ctrl.minDistance=0.55; ctrl.maxDistance=12; ctrl.enablePan=false; this.ctrl=ctrl;

      scene.add(new THREE.AmbientLight(0x35506f, .55));
      var sun=new THREE.DirectionalLight(0xfff3e0, 1.75); scene.add(sun); this.sun=sun;
      var rim=new THREE.DirectionalLight(0x3a7bd5,.4); rim.position.set(-3,-1,-2); scene.add(rim);

      var earthGroup=new THREE.Group(); scene.add(earthGroup); this.earthGroup=earthGroup;

      // Real photographic Earth — textures embedded as data-URIs (CSP-safe, no network).
      var loader=new THREE.TextureLoader();
      var mat=new THREE.MeshPhongMaterial({
        map:loader.load(TEX.day),
        specularMap:loader.load(TEX.spec),
        normalMap:loader.load(TEX.normal),
        normalScale:new THREE.Vector2(.85,.85),
        specular:new THREE.Color(0x24435c), shininess:11
      });
      var earth=new THREE.Mesh(new THREE.SphereGeometry(this.ER,96,96),mat); earthGroup.add(earth); this.earth=earth;

      var clouds=new THREE.Mesh(new THREE.SphereGeometry(this.ER*1.006,72,72),
        new THREE.MeshPhongMaterial({map:loader.load(TEX.clouds),transparent:true,opacity:.5,depthWrite:false}));
      earthGroup.add(clouds); this.clouds=clouds;

      this.buildGraticule();
      this.beam=new THREE.Mesh(new THREE.ConeGeometry(1,1,40,1,true), new THREE.MeshBasicMaterial({color:0x4fd6ff,transparent:true,opacity:0.07,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending})); this.beam.visible=false; this.scene.add(this.beam);

      var atmo=new THREE.Mesh(new THREE.SphereGeometry(this.ER*1.13,64,64), new THREE.ShaderMaterial({
        transparent:true, side:THREE.BackSide, blending:THREE.AdditiveBlending, depthWrite:false,
        uniforms:{c:{value:new THREE.Color(0x4fb4ff)}},
        vertexShader:'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader:'varying vec3 vN; uniform vec3 c; void main(){ float i=pow(.72-dot(vN,vec3(0.,0.,1.)),3.2); gl_FragColor=vec4(c,1.0)*clamp(i,0.,1.)*1.15; }'
      })); scene.add(atmo);

      this.makeStars();

      this.userInEarth=new THREE.Group(); earthGroup.add(this.userInEarth);
      var pin=new THREE.Mesh(new THREE.SphereGeometry(.012,16,16), new THREE.MeshBasicMaterial({color:0xff4f8b}));
      var halo=new THREE.Mesh(new THREE.RingGeometry(.02,.028,32), new THREE.MeshBasicMaterial({color:0xff4f8b,transparent:true,opacity:.8,side:THREE.DoubleSide}));
      this.userInEarth.add(pin); this.userInEarth.add(halo); this.userInEarth.visible=false; this._userHalo=halo;

      this.glowTex={ op:this.makeGlow('#bfefff','rgba(79,214,255,0.42)'), sel:this.makeGlow('#ffffff','rgba(127,233,255,0.6)'), planned:this.makeGlow('#ffe2bf','rgba(255,150,60,0.4)') };

      rnd.domElement.addEventListener('pointerdown',function(e){self._down=[e.clientX,e.clientY];});
      rnd.domElement.addEventListener('pointermove',function(e){ var r=rnd.domElement.getBoundingClientRect(); self.mouse={x:e.clientX-r.left,y:e.clientY-r.top}; });
      rnd.domElement.addEventListener('pointerleave',function(){ self.mouse=null; });
      rnd.domElement.addEventListener('pointerup',function(e){ if(self._down&&Math.hypot(e.clientX-self._down[0],e.clientY-self._down[1])<6){ var r=rnd.domElement.getBoundingClientRect(); self.clickAt(e.clientX-r.left,e.clientY-r.top); } });
      window.addEventListener('resize',function(){self.onResize();});
    },

    // procedural equirectangular earth (cosmetic; region labels are computed analytically)
    makeEarthCanvas: function(){
      var w=1024,h=512,c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');
      var g=x.createLinearGradient(0,0,0,h);
      g.addColorStop(0,'#071a2b');g.addColorStop(.5,'#0a2942');g.addColorStop(1,'#071a2b');
      x.fillStyle=g;x.fillRect(0,0,w,h);
      // faint ocean speckle
      for(var i=0;i<2200;i++){ x.fillStyle='rgba(90,150,200,'+(Math.random()*0.04)+')'; var px=Math.random()*w,py=Math.random()*h,s=Math.random()*2; x.fillRect(px,py,s,s); }
      // continents: rough lon/lat blob clusters -> px=(lon+180)/360*w, py=(90-lat)/180*h
      var ll=function(lon,lat){ return [ (lon+180)/360*w, (90-lat)/180*h ]; };
      var blobs=[
        // [lon,lat,rx,ry]
        [-100,45,70,55],[-95,30,55,45],[-75,5,38,55],[-60,-15,45,60],[-65,-40,28,35], // Americas
        [12,50,55,40],[20,8,70,55],[25,-25,48,52],                                     // Europe + Africa
        [60,55,90,45],[95,30,85,55],[110,-2,42,30],[134,-25,52,38],                    // Asia + SE Asia + Australia
        [-160,62,40,28]                                                                // far NE Russia/Alaska wrap
      ];
      x.save();
      blobs.forEach(function(b){
        var p=ll(b[0],b[1]);
        var grd=x.createRadialGradient(p[0],p[1],2,p[0],p[1],Math.max(b[2],b[3]));
        grd.addColorStop(0,'rgba(34,74,58,0.95)');
        grd.addColorStop(.6,'rgba(26,58,48,0.85)');
        grd.addColorStop(1,'rgba(20,44,40,0)');
        x.fillStyle=grd;
        x.beginPath(); x.ellipse(p[0],p[1],b[2],b[3],0,0,Math.PI*2); x.fill();
      });
      x.restore();
      // coast highlight noise on land
      x.globalCompositeOperation='lighter';
      for(var j=0;j<1400;j++){ var bx=blobs[(Math.random()*blobs.length)|0]; var bp=ll(bx[0],bx[1]); var ang=Math.random()*Math.PI*2,rr=Math.random(); var qx=bp[0]+Math.cos(ang)*rr*bx[2],qy=bp[1]+Math.sin(ang)*rr*bx[3]; x.fillStyle='rgba(70,120,95,'+(Math.random()*0.06)+')'; x.fillRect(qx,qy,1.4,1.4); }
      x.globalCompositeOperation='source-over';
      return c;
    },
    makeCloudCanvas: function(){
      var w=1024,h=512,c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');
      x.clearRect(0,0,w,h);
      for(var i=0;i<70;i++){
        var px=Math.random()*w, py=Math.random()*h, r=20+Math.random()*70;
        var grd=x.createRadialGradient(px,py,0,px,py,r);
        grd.addColorStop(0,'rgba(255,255,255,'+(0.10+Math.random()*0.14)+')');
        grd.addColorStop(1,'rgba(255,255,255,0)');
        x.fillStyle=grd; x.beginPath(); x.arc(px,py,r,0,Math.PI*2); x.fill();
      }
      return c;
    },

    makeStars: function(){
      var n=2600, pos=new Float32Array(n*3), col=new Float32Array(n*3);
      for(var i=0;i<n;i++){ var r=30+Math.random()*30, t=Math.random()*Math.PI*2, p=Math.acos(2*Math.random()-1);
        pos[i*3]=r*Math.sin(p)*Math.cos(t); pos[i*3+1]=r*Math.cos(p); pos[i*3+2]=r*Math.sin(p)*Math.sin(t);
        var b=.5+Math.random()*.5, tint=Math.random(); col[i*3]=b*(tint>.8?.7:1); col[i*3+1]=b; col[i*3+2]=b*(tint<.2?.8:1); }
      var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('color',new THREE.BufferAttribute(col,3));
      this.scene.add(new THREE.Points(g,new THREE.PointsMaterial({size:.13,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:.9})));
    },

    makeGlow: function(core, halo){
      var S=128, c=document.createElement('canvas'); c.width=c.height=S; var x=c.getContext('2d');
      var g=x.createRadialGradient(S/2,S/2,0,S/2,S/2,S/2);
      g.addColorStop(0,'rgba(255,255,255,0.95)');
      g.addColorStop(0.16, core);
      g.addColorStop(0.42, halo);
      g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.fillRect(0,0,S,S); var t=new THREE.Texture(c); t.needsUpdate=true; return t;
    },

    eciToVec: function(p){ return new THREE.Vector3(p.x*this.KM, p.z*this.KM, p.y*this.KM); },

    // ---------- SATELLITES ----------
    buildSats: function(){
      var self=this;
      this.fleet.forEach(function(f){
        if(!f._tle) return;   // lost / no-orbit sats are listed but not plotted
        var satrec; try{ satrec=satellite.twoline2satrec(f._tle[0],f._tle[1]); }catch(e){ console.warn('tle parse',f.id,e); return; }
        var incDeg=satrec.inclo*180/Math.PI;
        var mm=satrec.no*1440/(2*Math.PI);
        var periodMin=1440/mm;
        var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:self.glowTex.op,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
        sp.scale.setScalar(.12); self.scene.add(sp);
        var core=new THREE.Mesh(new THREE.SphereGeometry(.009,12,12),new THREE.MeshBasicMaterial({color:0xf2fbff})); self.scene.add(core);
        var orbit=self.buildOrbit(satrec,0x4fd6ff,.32); self.scene.add(orbit);
        var fp=self.buildFootprint(0x4fd6ff,.16); self.scene.add(fp);
        self.satObjs.push(Object.assign({}, f, { satrec:satrec, sp:sp, core:core, orbit:orbit, fp:fp, kind:'op', incDeg:incDeg, periodMin:periodMin }));
      });
      if(this.dom.refOpCount) this.dom.refOpCount.textContent=this.satObjs.length;
    },

    buildOrbit: function(satrec, color, opacity){
      var pts=[]; var now=new Date(); var periodMs=(1440/(satrec.no*1440/(2*Math.PI)))*60000;
      for(var i=0;i<=160;i++){
        var t=new Date(now.getTime()+ (i/160)*periodMs);
        var pv=satellite.propagate(satrec,t); if(!pv.position) continue;
        pts.push(this.eciToVec(pv.position));
      }
      var g=new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.Line(g,new THREE.LineBasicMaterial({color:color,transparent:true,opacity:opacity}));
    },

    buildFootprint: function(color,opacity){
      var m=new THREE.Mesh(new THREE.CircleGeometry(1,64),new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.07,side:THREE.DoubleSide,depthWrite:false}));
      var ring=new THREE.Mesh(new THREE.RingGeometry(.975,1,64),new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.55,side:THREE.DoubleSide,depthWrite:false}));
      m.add(ring); m.visible=false; m.renderOrder=2; return m;
    },

    buildPlanned: function(){
      var alt=700, rad=(6371+alt)*this.KM, inc=53*Math.PI/180, planes=6, perPlane=8, mm=15.07;
      var angVel=(mm*2*Math.PI/1440)/60;
      for(var p=0;p<planes;p++){
        var raan=(p/planes)*Math.PI*2;
        var pts=[];
        for(var i=0;i<=120;i++){ var th=(i/120)*Math.PI*2; pts.push(this.plannedPos(rad,inc,raan,th)); }
        var ring=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:0xff9e45,transparent:true,opacity:.13}));
        this.scene.add(ring);
        for(var s=0;s<perPlane;s++){
          var ph=(s/perPlane)*Math.PI*2 + p*0.3;
          var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:this.glowTex.planned,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
          sp.scale.setScalar(.045); this.scene.add(sp);
          this.plannedObjs.push({sp:sp,ring:ring,rad:rad,inc:inc,raan:raan,ph:ph,angVel:angVel});
        }
      }
    },
    plannedPos: function(rad,inc,raan,th){
      var x=Math.cos(th)*rad, y=Math.sin(th)*rad, z=0;
      var y2=y*Math.cos(inc)-z*Math.sin(inc), z2=y*Math.sin(inc)+z*Math.cos(inc); y=y2; z=z2;
      var x2=x*Math.cos(raan)-y*Math.sin(raan), y3=x*Math.sin(raan)+y*Math.cos(raan); x=x2; y=y3;
      return new THREE.Vector3(x, z, y);
    },

    // ---------- INTERACTION ----------
    onResize: function(){ if(!this.renderer)return; var m=this.dom.mountRef,W=m.clientWidth,H=m.clientHeight; if(W<=0||H<=0)return; this._lw=W; this._lh=H; this.cam.aspect=W/H; this.cam.updateProjectionMatrix(); this.renderer.setSize(W,H); },

    toggleList: function(){ this.listOpen=!this.listOpen; this.dom.listBody.style.display=this.listOpen?'block':'none'; this.dom.chevron.textContent=this.listOpen?'▾':'▸'; },
    onTogglePlanned: function(){ this.showPlanned=!this.showPlanned; this.plannedObjs.forEach(function(o){o.sp.visible=this.showPlanned; o.ring.visible=this.showPlanned;}.bind(this)); if(this.dom.refPlannedToggle) this.dom.refPlannedToggle.textContent=this.showPlanned?'ON':'OFF'; },

    select: function(id){
      var self=this;
      var s=this.satObjs.find(function(o){return o.id===id;}); if(!s)return;
      this.selectedId=id; this.passTarget=null;
      this.satObjs.forEach(function(o){ var sel=o.id===id; o.sp.material.map=sel?self.glowTex.sel:self.glowTex.op; o.sp.material.needsUpdate=true; o.sp.scale.setScalar(sel?.18:.12); o.orbit.material.opacity=sel?.85:.12; o.orbit.material.color.set(sel?0x9fefff:0x4fd6ff); o.fp.visible=sel; });
      this.dom.selPanel.style.display='block';
      byId('selName').textContent=s.name; byId('selId').textContent=s.norad; byId('selBlock').textContent=s.block;
      this.setMission(s);
      var endCam=this.framingPos(s.sp.position); var D=this.cam.position.distanceTo(endCam);
      this.ease={active:true, t:0, spd:1/Math.min(150,Math.max(75,D*46)), startTarget:this.ctrl.target.clone(), startCam:this.cam.position.clone()};
      if(this.userLL) this.computePass(s.satrec);
    },
    setMission: function(f){
      if(this.dom.refLaunch) this.dom.refLaunch.textContent=f.launch||'—';
      if(this.dom.refRocket) this.dom.refRocket.textContent=f.rocket||'—';
      if(this.dom.refSite) this.dom.refSite.textContent=f.site||'—';
      var online=f.status!=='lost', c=online?'#7CFFCB':'#ff5a6a', label=online?'ONLINE':'LOST · DEORBITING';
      var st=this.dom.refStatus;
      if(st){ st.style.color=c; st.innerHTML='<span style="width:7px;height:7px;border-radius:50%;background:'+c+';box-shadow:0 0 8px '+c+';flex:none;"></span>'+label; }
    },

    showLost: function(f){
      var self=this;
      this.selectedId=null; this.passTarget=null; if(this.beam) this.beam.visible=false;
      this.satObjs.forEach(function(o){ o.sp.material.map=self.glowTex.op; o.sp.material.needsUpdate=true; o.sp.scale.setScalar(.12); o.orbit.material.opacity=.32; o.orbit.material.color.set(0x4fd6ff); o.fp.visible=false; });
      var D=this.cam.position.distanceTo(this.defaultCam);
      this.ease={active:true, t:0, out:true, spd:1/Math.min(150,Math.max(75,D*46)), startTarget:this.ctrl.target.clone(), startCam:this.cam.position.clone()};
      this.dom.selPanel.style.display='block';
      byId('selName').textContent=f.name; byId('selId').textContent=f.norad; byId('selBlock').textContent=f.block;
      ['refAlt','refVel','refInc','refPer','refGeo','refCov'].forEach(function(k){ if(self.dom[k]) self.dom[k].textContent='—'; });
      if(this.dom.refRegion) this.dom.refRegion.textContent='NO ACTIVE ORBIT';
      if(this.dom.refChips){ var ch=this.dom.refChips.children; for(var k=0;k<ch.length;k++){ ch[k].style.background='transparent'; ch[k].style.color='#41618a'; ch[k].style.borderColor='rgba(79,214,255,.14)'; ch[k].style.boxShadow='none'; } }
      if(this.dom.refPass) this.dom.refPass.textContent='LOST — OFF-NOMINAL ORBIT';
      this.setMission(f);
    },

    deselect: function(){
      var self=this;
      this.selectedId=null; this.passTarget=null; if(this.beam) this.beam.visible=false;
      this.satObjs.forEach(function(o){ o.sp.material.map=self.glowTex.op; o.sp.material.needsUpdate=true; o.sp.scale.setScalar(.12); o.orbit.material.opacity=.32; o.orbit.material.color.set(0x4fd6ff); o.fp.visible=false; });
      this.dom.selPanel.style.display='none';
      var D=this.cam.position.distanceTo(this.defaultCam);
      this.ease={active:true, t:0, out:true, spd:1/Math.min(150,Math.max(75,D*46)), startTarget:this.ctrl.target.clone(), startCam:this.cam.position.clone()};
    },

    // ---------- GEOLOCATION ----------
    locateMe: function(silent){
      var self=this;
      if(!navigator.geolocation || !window.isSecureContext){
        if(silent) this.locFail('ENABLE MY LOCATION'); else this.showManual('AUTO-LOCATION UNAVAILABLE');
        return;
      }
      if(this.dom.refLocLabel) this.dom.refLocLabel.textContent='LOCATING…';
      navigator.geolocation.getCurrentPosition(
        function(pos){ self.hideManual(); self.setUser(pos.coords.latitude,pos.coords.longitude); },
        function(err){
          if(silent){ self.locFail('ENABLE MY LOCATION'); return; }
          self.showManual((err && err.code===1) ? 'LOCATION BLOCKED HERE' : 'LOCATION UNAVAILABLE');
        },
        {enableHighAccuracy:false,timeout:8000,maximumAge:60000}
      );
    },
    locFail: function(msg){ if(this.dom.refLocLabel) this.dom.refLocLabel.textContent=msg; if(this.dom.refLocSub) this.dom.refLocSub.textContent='tap to plot & check coverage'; },

    // In-page fallback when the browser/iframe blocks geolocation (works everywhere).
    showManual: function(why){
      if(this.dom.refLocLabel) this.dom.refLocLabel.textContent=why||'ENTER LOCATION';
      if(this.dom.refLocSub) this.dom.refLocSub.textContent='type it below ↓';
      if(this.dom.locManual) this.dom.locManual.style.display='block';
      if(this.dom.locInput){ try{ this.dom.locInput.focus(); }catch(e){} }
    },
    hideManual: function(){ if(this.dom.locManual) this.dom.locManual.style.display='none'; },
    submitManual: function(){
      var s=(this.dom.locInput && this.dom.locInput.value || '').trim();
      var ll=this.parseLatLon(s);
      if(ll){ this.hideManual(); this.setUser(ll.lat,ll.lon); }
      else if(this.dom.locInput){ this.dom.locInput.style.borderColor='#ff5a6a'; this.dom.locInput.value=''; this.dom.locInput.placeholder='try: 40.71, -74.01  or  London'; }
    },
    parseLatLon: function(str){
      if(!str) return null;
      var key=str.toLowerCase().replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim();
      if(this.cities[key]) return {lat:this.cities[key][0], lon:this.cities[key][1]};
      var m=str.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
      if(m){ var lat=parseFloat(m[1]), lon=parseFloat(m[2]); if(lat>=-90&&lat<=90&&lon>=-180&&lon<=180) return {lat:lat,lon:lon}; }
      return null;
    },
    cities: {'new york':[40.71,-74.01],'london':[51.51,-0.13],'tokyo':[35.68,139.69],'san francisco':[37.77,-122.42],'los angeles':[34.05,-118.24],'chicago':[41.88,-87.63],'paris':[48.85,2.35],'berlin':[52.52,13.40],'madrid':[40.42,-3.70],'singapore':[1.35,103.82],'sydney':[-33.87,151.21],'dubai':[25.20,55.27],'sao paulo':[-23.55,-46.63],'mexico city':[19.43,-99.13],'lagos':[6.52,3.38],'mumbai':[19.08,72.88],'delhi':[28.61,77.21],'beijing':[39.90,116.40],'shanghai':[31.23,121.47],'hong kong':[22.32,114.17],'seoul':[37.57,126.98],'toronto':[43.65,-79.38],'cairo':[30.04,31.24],'moscow':[55.76,37.62],'istanbul':[41.01,28.98]},

    setUser: function(lat,lon){
      this.hideManual();
      this.userLL={lat:lat,lon:lon};
      var latR=lat*Math.PI/180, lonR=lon*Math.PI/180;
      var ex=Math.cos(latR)*Math.cos(lonR), ey=Math.cos(latR)*Math.sin(lonR), ez=Math.sin(latR);
      this.userInEarth.position.set(ex*this.ER*1.01, ez*this.ER*1.01, -ey*this.ER*1.01);
      this.userInEarth.lookAt(0,0,0); this.userInEarth.visible=true;
      if(this.dom.refLocLabel) this.dom.refLocLabel.textContent=Math.abs(lat).toFixed(2)+'°'+(lat>=0?'N':'S')+'  '+Math.abs(lon).toFixed(2)+'°'+(lon>=0?'E':'W');
      if(this.dom.refLocSub) this.dom.refLocSub.textContent='LOCATION LOCKED · CHECKING COVERAGE';
      var s=this.satObjs.find(function(o){return o.id===this.selectedId;}.bind(this)); if(s) this.computePass(s.satrec);
    },

    lookAngles: function(satrec,date){
      var gmst=satellite.gstime(date); var pv=satellite.propagate(satrec,date); if(!pv.position) return null;
      var ecf=satellite.eciToEcf(pv.position,gmst);
      var obs={longitude:this.userLL.lon*Math.PI/180, latitude:this.userLL.lat*Math.PI/180, height:.1};
      return satellite.ecfToLookAngles(obs,ecf);
    },
    computePass: function(satrec){
      if(!this.userLL){return;} this.passTarget=null; this.passEl=0;
      var now=Date.now(); var best=null;
      for(var dt=0; dt<6*3600; dt+=20){
        var la=this.lookAngles(satrec,new Date(now+dt*1000)); if(!la) continue;
        var el=la.elevation*180/Math.PI;
        if(el>10){ if(!best){ best={start:now+dt*1000, peak:el}; } else { if(el>best.peak) best.peak=el; } }
        else if(best){ break; }
      }
      if(best){ this.passTarget=best.start; this.passEl=Math.round(best.peak); }
      else if(this.dom.refPass) this.dom.refPass.textContent='NO PASS IN NEXT 6H';
    },
    checkCoverage: function(){
      if(!this.userLL||!this._userHalo) return;
      var now=new Date(); var covered=false;
      for(var i=0;i<this.satObjs.length;i++){ var la=this.lookAngles(this.satObjs[i].satrec,now); if(la && la.elevation*180/Math.PI>10){ covered=true; break; } }
      var c=covered?0x7CFFCB:0xff4f8b;
      this._userHalo.material.color.set(c); if(this.dom.refLocDot){ var hex=covered?'#7CFFCB':'#ff4f8b'; this.dom.refLocDot.style.background=hex; this.dom.refLocDot.style.boxShadow='0 0 9px '+hex; }
      if(this.dom.refLocSub) this.dom.refLocSub.textContent= covered? '● IN COVERAGE — CELLULAR LINK': '○ NO SATELLITE OVERHEAD';
    },

    // ---------- LOOP ----------
    animate: function(){
      var self=this;
      this._raf=requestAnimationFrame(function(){self.animate();});
      var m=this.dom.mountRef;
      if(m){ var W=m.clientWidth, H=m.clientHeight; if(W>0&&H>0&&(W!==this._lw||H!==this._lh)){ this._lw=W; this._lh=H; this.cam.aspect=W/H; this.cam.updateProjectionMatrix(); this.renderer.setSize(W,H); } }
      var now=new Date();
      var gmst=satellite.gstime(now);
      this.earthGroup.rotation.y=gmst;
      if(this.clouds) this.clouds.rotation.y+=0.00008;

      var sd=this.sunEci(now); this.sun.position.set(sd.x*10, sd.z*10, sd.y*10);

      var selPos=null, sel=null;
      this.satObjs.forEach(function(s){
        var pv=satellite.propagate(s.satrec,now); if(!pv.position) return;
        var v=self.eciToVec(pv.position); s.sp.position.copy(v); s.core.position.copy(v);
        if(s.fp.visible){ var sub=v.clone().normalize().multiplyScalar(self.ER*1.002); s.fp.position.copy(sub); s.fp.lookAt(0,0,0);
          var gd=satellite.eciToGeodetic(pv.position,gmst); var altKm=gd.height; var ang=Math.acos(self.ER*6371/(6371+altKm)); var r=self.ER*Math.sin(ang); s.fp.scale.setScalar(r/1);
          var groundN=v.clone().normalize(); var grnd=groundN.clone().multiplyScalar(self.ER); var hh=v.length()-self.ER; var mid=v.clone().add(grnd).multiplyScalar(.5);
          self.beam.position.copy(mid); self.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),groundN); self.beam.scale.set(r,hh,r); self.beam.visible=true; }
        if(s.id===self.selectedId){ selPos=v; sel={s:s,pv:pv,gmst:gmst}; }
      });

      if(this.showPlanned){ var t=now.getTime()/1000; this.plannedObjs.forEach(function(o){ o.sp.position.copy(self.plannedPos(o.rad,o.inc,o.raan,o.ph+t*o.angVel)); }); }

      if(sel){ var gd=satellite.eciToGeodetic(sel.pv.position,sel.gmst);
        var lat=gd.latitude*180/Math.PI, lon=gd.longitude*180/Math.PI, alt=gd.height;
        var vv=sel.pv.velocity, spd=Math.sqrt(vv.x*vv.x+vv.y*vv.y+vv.z*vv.z);
        var ang=Math.acos(6371/(6371+alt)); var covR=6371*ang;
        if(this.dom.refAlt) this.dom.refAlt.textContent=alt.toFixed(1)+' km';
        if(this.dom.refVel) this.dom.refVel.textContent=spd.toFixed(2)+' km/s';
        if(this.dom.refInc) this.dom.refInc.textContent=sel.s.incDeg.toFixed(1)+'°';
        if(this.dom.refPer) this.dom.refPer.textContent=sel.s.periodMin.toFixed(1)+' min';
        if(this.dom.refGeo) this.dom.refGeo.textContent=Math.abs(lat).toFixed(1)+'°'+(lat>=0?'N':'S')+' '+Math.abs(lon).toFixed(1)+'°'+(lon>=0?'E':'W');
        if(this.dom.refCov) this.dom.refCov.textContent=Math.round(covR*2).toLocaleString()+' km';
        var reg=this.regionFor(lat,lon);
        if(this.dom.refRegion && this.dom.refRegion.textContent!==reg.name) this.dom.refRegion.textContent=reg.name;
        if(this.dom.refChips){ var ch=this.dom.refChips.children; for(var k=0;k<ch.length;k++){ var on=ch[k].dataset.code===reg.code; ch[k].style.background=on?'rgba(79,214,255,.18)':'transparent'; ch[k].style.color=on?'#eaf8ff':'#41618a'; ch[k].style.borderColor=on?'rgba(127,233,255,.75)':'rgba(79,214,255,.14)'; ch[k].style.boxShadow=on?'0 0 13px rgba(79,214,255,.4)':'none'; } }
      }

      if(this.ease.active){ this.ease.t=Math.min(1,this.ease.t+(this.ease.spd||0.018)); var u=this.ease.t; var kk=u*u*u*(u*(u*6-15)+10);
        if(this.ease.out){ this.ctrl.target.lerpVectors(this.ease.startTarget,new THREE.Vector3(0,0,0),kk); this.cam.position.copy(this.arcCamPos(this.ease.startCam,this.defaultCam,kk)); }
        else if(selPos){ this.ctrl.target.lerpVectors(this.ease.startTarget,selPos,kk); this.cam.position.copy(this.arcCamPos(this.ease.startCam,this.framingPos(selPos),kk)); }
        if(this.ease.t>=1) this.ease.active=false;
      } else if(selPos){ this.ctrl.target.lerp(selPos,0.05); this.cam.position.lerp(this.framingPos(selPos),0.012); }

      if(!this._covT||now-this._covT>2000){ this._covT=now; this.checkCoverage(); }

      this.updateHud3d();
      this.ctrl.update();
      this.renderer.render(this.scene,this.cam);
    },

    regionFor: function(lat,lon){
      var inb=function(a,b,c,d){ return lat>=a&&lat<=b&&lon>=c&&lon<=d; };
      if(inb(14,72,-168,-52)) return {code:'NA',name:'NORTH AMERICA'};
      if(inb(-56,14,-82,-34)) return {code:'SA',name:'SOUTH AMERICA'};
      if(inb(36,71,-10,40))   return {code:'EU',name:'EUROPE'};
      if(inb(-35,37,-17,52))  return {code:'AF',name:'AFRICA'};
      if(inb(5,72,40,150))    return {code:'AS',name:'ASIA'};
      if(inb(-11,6,95,142))   return {code:'AS',name:'SOUTHEAST ASIA'};
      if(inb(-48,-10,112,179))return {code:'OC',name:'AUSTRALIA'};
      if(lon>=-68&&lon<20)    return {code:'',name:'ATLANTIC OCEAN'};
      if(lon>=20&&lon<105)    return {code:'',name:'INDIAN OCEAN'};
      return {code:'',name:'PACIFIC OCEAN'};
    },

    // Move the camera along a great-circle arc around the globe (never through it).
    // Slerp the view direction, interpolate the radius, and bulge outward mid-flight.
    arcCamPos: function(startCam, endCam, k){
      var sDir=startCam.clone().normalize(), sR=startCam.length();
      var eDir=endCam.clone().normalize(), eR=endCam.length();
      var q=new THREE.Quaternion().setFromUnitVectors(sDir, eDir);
      var theta=2*Math.acos(Math.min(1,Math.abs(q.w)));        // total arc angle 0..PI
      var qk=new THREE.Quaternion().slerp(q, k);               // partial rotation from identity
      var dir=sDir.clone().applyQuaternion(qk);
      var r=sR+(eR-sR)*k + Math.sin(Math.PI*k)*(theta/Math.PI)*0.55;  // lift scales with arc length
      if(r<1.25) r=1.25;                                       // stay clear of surface/atmosphere
      return dir.multiplyScalar(r);
    },

    framingPos: function(selPos){
      var satDir=selPos.clone().normalize();
      var up=new THREE.Vector3(0,1,0);
      var tang=new THREE.Vector3().crossVectors(satDir,up); if(tang.lengthSq()<1e-5) tang.set(1,0,0); tang.normalize();
      var camGap=0.95;
      return selPos.clone()
        .add(satDir.clone().multiplyScalar(camGap))
        .add(tang.multiplyScalar(0.30))
        .add(up.multiplyScalar(0.24));
    },

    sunEci: function(date){
      var rad=Math.PI/180, jd=date.getTime()/86400000+2440587.5, n=jd-2451545.0;
      var L=(280.460+0.9856474*n)%360, g=((357.528+0.9856003*n)%360)*rad;
      var lam=(L+1.915*Math.sin(g)+0.020*Math.sin(2*g))*rad, eps=23.439*rad;
      return {x:Math.cos(lam), y:Math.cos(eps)*Math.sin(lam), z:Math.sin(eps)*Math.sin(lam)};
    },

    // ---------- TACTICAL HUD OVERLAY ----------
    project: function(v){ var p=v.clone().project(this.cam); var c=this.renderer.domElement; return {x:(p.x*.5+.5)*c.clientWidth, y:(-p.y*.5+.5)*c.clientHeight, vis:p.z<1}; },
    occluded: function(v){ var o=this.cam.position; var d=v.clone().sub(o); var dist=d.length(); d.normalize(); var tca=-o.dot(d); var dd=o.dot(o)-tca*tca; if(dd>1) return false; var thc=Math.sqrt(1-dd); var t0=tca-thc; return t0>0.002 && t0<dist-0.03; },

    buildGraticule: function(){
      var g=new THREE.Group(); var mat=new THREE.LineBasicMaterial({color:0x4fd6ff,transparent:true,opacity:0.11,blending:THREE.AdditiveBlending,depthWrite:false}); var R=1.012;
      for(var lat=-60;lat<=60;lat+=30){ var y=Math.sin(lat*Math.PI/180)*R, r=Math.cos(lat*Math.PI/180)*R; var pts=[]; for(var i=0;i<=72;i++){var a=i/72*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r));} g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat)); }
      for(var lon=0;lon<180;lon+=30){ var pts2=[]; for(var i2=0;i2<=72;i2++){var a2=i2/72*Math.PI*2; var x=Math.cos(a2)*R, y2=Math.sin(a2)*R; var ll=lon*Math.PI/180; pts2.push(new THREE.Vector3(x*Math.cos(ll),y2,x*Math.sin(ll)));} g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts2),mat)); }
      this.earthGroup.add(g);
    },

    buildHud3d: function(){
      var self=this;
      var root=this.dom.mountRef; var layer=document.createElement('div'); layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden;'; root.appendChild(layer); this.hudLayer=layer;
      this.labelEls={};
      this.satObjs.forEach(function(s){
        var el=document.createElement('div');
        el.style.cssText="position:absolute;transform:translateY(-50%);pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10px;letter-spacing:.12em;white-space:nowrap;will-change:left,top;padding:4px 6px 4px 0;";
        el.innerHTML='<span class="mk" style="flex:none;width:9px;height:9px;margin-left:-4.5px;border:1.4px solid #4fd6ff;border-radius:50%;box-shadow:0 0 7px rgba(79,214,255,.6);transition:all .12s;"></span><span class="nm" style="opacity:.55;color:#a8cdee;text-shadow:0 0 8px rgba(79,214,255,.6);transition:all .12s;">'+s.name.toUpperCase()+'</span>';
        el.addEventListener('click',function(ev){ev.stopPropagation();self.select(s.id);});
        el.addEventListener('pointerenter',function(){self._labelHover=s.id;});
        el.addEventListener('pointerleave',function(){if(self._labelHover===s.id)self._labelHover=null;});
        layer.appendChild(el); self.labelEls[s.id]=el;
      });
      this.hoverRet=this.makeReticle('hover'); layer.appendChild(this.hoverRet);
      this.targetRet=this.makeReticle('target'); layer.appendChild(this.targetRet);
    },

    makeReticle: function(kind){
      var el=document.createElement('div'); el.style.cssText='position:absolute;transform:translate(-50%,-50%);pointer-events:none;display:none;will-change:left,top;';
      if(kind==='target'){
        var ticks=['top:-1px;left:50%;width:1px;height:11px;','bottom:-1px;left:50%;width:1px;height:11px;','left:-1px;top:50%;height:1px;width:11px;','right:-1px;top:50%;height:1px;width:11px;'].map(function(s){return '<div style="position:absolute;'+s+'background:#7fe9ff;box-shadow:0 0 7px #7fe9ff;transform:translate(-50%,-50%);"></div>';}).join('');
        el.innerHTML='<div style="position:relative;width:94px;height:94px;">'+
          '<div style="position:absolute;inset:0;border:1px dashed rgba(127,233,255,.8);border-radius:50%;animation:spin 12s linear infinite;"></div>'+
          '<div style="position:absolute;inset:13px;border:1px solid rgba(127,233,255,.3);border-top-color:transparent;border-bottom-color:transparent;border-radius:50%;animation:spinR 7s linear infinite;"></div>'+
          ticks+
          '<div style="position:absolute;left:50%;top:50%;width:3px;height:3px;background:#fff;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 9px #7fe9ff;"></div>'+
          '</div>'+
          '<div class="rl" style="position:absolute;left:62px;top:-8px;line-height:1.45;font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:#cfeeff;text-shadow:0 0 9px rgba(79,214,255,.9);"></div>';
      }else{
        var cor=['top:0;left:0;border-top:1.5px solid #4fd6ff;border-left:1.5px solid #4fd6ff;','top:0;right:0;border-top:1.5px solid #4fd6ff;border-right:1.5px solid #4fd6ff;','bottom:0;left:0;border-bottom:1.5px solid #4fd6ff;border-left:1.5px solid #4fd6ff;','bottom:0;right:0;border-bottom:1.5px solid #4fd6ff;border-right:1.5px solid #4fd6ff;'].map(function(s){return '<div style="position:absolute;width:11px;height:11px;'+s+'box-shadow:0 0 6px rgba(79,214,255,.6);"></div>';}).join('');
        el.innerHTML='<div style="position:relative;width:50px;height:50px;">'+cor+'</div>';
      }
      return el;
    },

    updateHud3d: function(){
      var self=this;
      if(!this.hudLayer) return; var c=this.renderer.domElement;
      var near=null, nd=56; var screen={};
      this.satObjs.forEach(function(s){ var p=self.project(s.sp.position); var occ=self.occluded(s.sp.position); screen[s.id]={p:p,occ:occ};
        if(self.mouse && p.vis && !occ){ var dx=p.x-self.mouse.x, dy=p.y-self.mouse.y, dd=Math.hypot(dx,dy); if(dd<nd){nd=dd;near=s.id;} } });
      this.hoverId = near || this._labelHover || null;
      c.style.cursor = this.hoverId? 'pointer' : 'grab';
      this.satObjs.forEach(function(s){ var el=self.labelEls[s.id]; var o=screen[s.id]; if(!o.p.vis||o.occ){ el.style.display='none'; return; } el.style.display='flex'; el.style.left=o.p.x+'px'; el.style.top=o.p.y+'px';
        var active=s.id===self.hoverId||s.id===self.selectedId; var nm=el.querySelector('.nm'), mk=el.querySelector('.mk');
        if(nm){ nm.style.opacity=active?'1':'.5'; nm.style.color=active?'#eaf8ff':'#9fc4e6'; }
        if(mk){ mk.style.background=active?'#7fe9ff':'transparent'; mk.style.borderColor=active?'#bff0ff':'#4fd6ff'; mk.style.boxShadow=active?'0 0 13px #7fe9ff':'0 0 7px rgba(79,214,255,.5)'; mk.style.width=active?'11px':'9px'; mk.style.height=active?'11px':'9px'; mk.style.marginLeft=active?'-5.5px':'-4.5px'; } });
      var hh=screen[this.hoverId];
      if(this.hoverId && this.hoverId!==this.selectedId && hh && hh.p.vis && !hh.occ){ this.hoverRet.style.display='block'; this.hoverRet.style.left=hh.p.x+'px'; this.hoverRet.style.top=hh.p.y+'px'; } else this.hoverRet.style.display='none';
      var t=screen[this.selectedId];
      if(this.selectedId && t && t.p.vis && !t.occ){ this.targetRet.style.display='block'; this.targetRet.style.left=t.p.x+'px'; this.targetRet.style.top=t.p.y+'px'; var s=this.satObjs.find(function(o){return o.id===self.selectedId;}); var rl=this.targetRet.querySelector('.rl'); if(rl) rl.innerHTML=s.name.toUpperCase()+'<br><span style="color:#86a4c4">'+((this.dom.refAlt&&this.dom.refAlt.textContent)||'')+'</span>'; } else if(this.targetRet) this.targetRet.style.display='none';
    },

    clickAt: function(cx,cy){
      var self=this;
      var near=null, nd=58;
      this.satObjs.forEach(function(s){ if(self.occluded(s.sp.position)) return; var p=self.project(s.sp.position); if(!p.vis) return; var d=Math.hypot(p.x-cx,p.y-cy); if(d<nd){ nd=d; near=s.id; } });
      if(near) this.select(near); else if(this.selectedId) this.deselect();
    }
  };

  if(document.readyState!=='loading') A.init();
  else document.addEventListener('DOMContentLoaded', function(){ A.init(); });
})();
