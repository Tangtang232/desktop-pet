// 同一个部位在两张原画上各有一套 UV；整段起身只绘制一个连续变化的轮廓。
// 纹理读取、透明边缘和实时表情沿用普通姿势的渲染器。
(function (root) {
'use strict';
const { ap, mul, fromRel, Rm, Tm } = root.PetRig;
const mix = (a, b, t) => a + (b - a) * t;
const unit = x => Math.max(0, Math.min(1, x));
const smooth = x => { const t = unit(x); return t * t * (3 - 2 * t); };
const poseNames = new Set(['prone','lie-down','crouch','stand','sit','curl','sleep']);
const legs = { 'front-leg-near':'fn', 'front-leg-far':'ff', 'hind-leg-near':'hn', 'hind-leg-far':'hf' };
const rows = 48, columns = 4;
const positions = (rows + 1) * (columns + 1) * 2;
const topology = new Uint16Array(rows * columns * 6);
const feetFirst = new Uint16Array(topology.length);
for (let r = 0, k = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
  const a = r * (columns + 1) + c, b = a + 1, d = a + columns + 1;
  feetFirst.set([a,b,d+1,a,d+1,d],((rows-1-r)*columns+c)*6);
  topology.set([a, b, d + 1, a, d + 1, d], k); k += 6;
}

// 躯干、尾巴沿长度切成竖条，耳朵、四肢从根部向爪尖切成横条。
// 每个截面在两张原画中都从一侧的毛边走到另一侧，花纹随同一张网格移动。
function profile(R, name, layer, im, pixels, weightsAt, bones, mirrored) {
  if (!poseNames.has(name)) return null;
  const horizontal = layer.id === 'body' || layer.id === 'tail';
  const length = horizontal ? im.width : im.height, width = horizontal ? im.height : im.width;
  const lows = new Int32Array(length).fill(width), highs = new Int32Array(length).fill(-1);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (pixels[(y * im.width + x) * 4 + 3] < 12) continue;
    const i = horizontal ? x : y, j = horizontal ? y : x;
    if (j < lows[i]) lows[i] = j;
    if (j > highs[i]) highs[i] = j;
  }
  const uv = new Float32Array(positions), rest = new Float32Array(positions);
  const weights = new Float32Array(positions / 2 * bones.length);
  const radius = Math.ceil(length / rows / 2);
  let last = width * .5;
  // 对齐到解剖方向：尾巴总从尾根向尾尖走，胸、臀在镜像的睡姿中仍是同一侧。
  const reverseRows = layer.id === 'tail' ? layer.chain[0][0] > layer.chain.at(-1)[0] : horizontal && mirrored;
  for (let row = 0, k = 0; row <= rows; row++) {
    const u = reverseRows ? 1 - row / rows : row / rows, axis = u * length;
    let lo = width, hi = -1;
    for (let i = Math.max(0, Math.floor(axis) - radius); i < Math.min(length, Math.ceil(axis) + radius + 1); i++) {
      lo = Math.min(lo, lows[i]); hi = Math.max(hi, highs[i]);
    }
    if (hi < lo) lo = hi = last;
    else last = (lo + hi) * .5;
    lo = Math.max(0, lo - 2) / width; hi = Math.min(width, hi + 3) / width;
    for (let c = 0; c <= columns; c++, k += 2) {
      const v = mix(lo, hi, !horizontal && mirrored ? 1-c/columns : c/columns), s = horizontal ? u : v, t = horizontal ? v : u;
      const x = layer.x + s * layer.w, y = layer.y + t * layer.h;
      uv[k] = s; uv[k + 1] = t; rest[k] = x; rest[k + 1] = y;
      weights.set(weightsAt(x, y), (k / 2) * bones.length);
    }
  }
  const idx=layer.id==='front-leg-near' || (layer.id==='tail' && ['prone','curl','sleep'].includes(name)) ? feetFirst:topology;
  const result = { mesh:R.bufs({part:layer.id, uv, pos:new Float32Array(positions), idx}), rest, weights, bones };
  if (layer.id.startsWith('front-leg') && ['sit','lie-down','prone'].includes(name)) {
    result.stride = forelegProfile(R,layer,im,pixels,weightsAt,bones,idx);
  }
  return result;
}

// 撑地时爪尖接近水平。截面跟着肩到脚掌的方向走，腕部与腕部对应。
function forelegProfile(R,layer,im,pixels,weightsAt,bones,idx){
  const dx=(layer.foot[0]-layer.pivot[0])*im.width/layer.w;
  const dy=(layer.foot[1]-layer.pivot[1])*im.height/layer.h;
  const len=Math.hypot(dx,dy)||1,nx=dx/len,ny=dy/len;
  const diag=Math.ceil(Math.hypot(im.width,im.height))+2;
  const lo=new Float32Array(2*diag+1).fill(Infinity),hi=new Float32Array(lo.length).fill(-Infinity);
  let first=lo.length,last=0;
  for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){
    if(pixels[(y*im.width+x)*4+3]<24)continue;
    const j=Math.round((x+.5)*nx+(y+.5)*ny)+diag;
    const side=(x+.5)*ny-(y+.5)*nx;
    lo[j]=Math.min(lo[j],side);hi[j]=Math.max(hi[j],side);
    first=Math.min(first,j);last=Math.max(last,j);
  }
  if(last<=first)return null;
  const uv=new Float32Array(positions),rest=new Float32Array(positions),weights=new Float32Array(positions);
  for(let r=0,k=0;r<=rows;r++){
    const along=mix(first-1,last+1,r/rows),i=Math.max(first,Math.min(last,Math.round(along)));
    let left=lo[i],right=hi[i];
    for(let j=Math.max(first,i-1);j<=Math.min(last,i+1);j++){left=Math.min(left,lo[j]);right=Math.max(right,hi[j]);}
    if(right<left)left=right=0;
    for(let c=0;c<=columns;c++,k+=2){
      const across=mix(left-1.25,right+1.25,c/columns);
      const u=(nx*(along-diag)+ny*across)/im.width,v=(ny*(along-diag)-nx*across)/im.height;
      uv[k]=u;uv[k+1]=v;
      const x=layer.x+u*layer.w,y=layer.y+v*layer.h;
      rest[k]=x;rest[k+1]=y;weights.set(weightsAt(x,y),k);
    }
  }
  return {mesh:R.bufs({part:layer.id,uv,pos:new Float32Array(positions),idx}),rest,weights,bones};
}

// 半蜷与熟睡的原画按眼、鼻等局部特征配准；侧面转向镜头使用下方的正面网格。
function headProfile(R,name,layer,im,points,mirrored,kit) {
  if (!['prone','curl','sleep'].includes(name)) return null;
  const w=layer.w, h=layer.h, eye=points?.eyeCenter || [w*.63,h*.535];
  const nose=points?.nose || [w*.94,h*.63], mouth=points?.mouthHold || [w*.77,h*.87];
  if(name==='prone')return {w,h,eye,nose,mouth};
  const canvas=document.createElement('canvas'); canvas.width=im.width; canvas.height=im.height;
  const ctx=canvas.getContext('2d'); ctx.drawImage(im,0,0);
  const pixels=ctx.getImageData(0,0,im.width,im.height).data;
  let polar;
  if(name!=='prone') {
    // 两张回望的脸以近眼为圆心、鼻尖为同一方向；内圈为同一个刚性五官区。
    const dirs=64, rings=10, radii=[], axes=[];
    const indices=new Uint16Array(dirs*rings*6), ex=nose[0]-eye[0],ey=nose[1]-eye[1],handed=mirrored?-1:1;
    const duv=new Float32Array((dirs+1)*(rings+1)*2);
    for(let j=0;j<=dirs;j++){
      const theta=2*Math.PI*j/dirs,dx=ex*Math.cos(theta)-handed*ey*Math.sin(theta),dy=ey*Math.cos(theta)+handed*ex*Math.sin(theta);
      let outer=0;
      for(let dist=0;dist<5;dist+=.01){
        const ix=Math.floor((eye[0]+dx*dist)*im.width/w),iy=Math.floor((eye[1]+dy*dist)*im.height/h);
        if(ix<0||ix>=im.width||iy<0||iy>=im.height)break;
        if(pixels[(iy*im.width+ix)*4+3]>7) outer=dist;
      }
      axes.push([dx,dy]);radii.push(outer+.022);
      if(j<dirs)for(let r=0;r<rings;r++){
        const i=j*(rings+1)+r,n=i+rings+1;indices.set([i,n,n+1,i,n+1,i+1],(j*rings+r)*6);
      }
    }
    polar={dirs,rings,radii,axes,mesh:R.bufs({part:'head',idx:indices,uv:duv,pos:new Float32Array(duv.length)})};
  }
  let wakingEye;
  if(name==='sleep' && kit?.eyes.half?.im) {
    // 在原睡脸上先掀开一条眼缝，抬头仍使用同一个口鼻和画好的脸颊。
    const patch=kit.eyes.half, eyeCanvas=document.createElement('canvas');
    eyeCanvas.width=im.width;eyeCanvas.height=im.height;
    const ec=eyeCanvas.getContext('2d');ec.scale(im.width/w,im.height/h);
    const size=w/kit.w*1.08, dx=eye[0]+(patch.x-kit.points.eyeCenter[0])*size,dy=eye[1]+(patch.y-kit.points.eyeCenter[1])*size;
    ec.drawImage(patch.im,dx,dy,patch.w*size,patch.h*size);
    ec.globalCompositeOperation='destination-in';ec.translate(...eye);ec.scale(w*.115,h*.084);
    const fade=ec.createRadialGradient(0,0,0,0,0,1);fade.addColorStop(0,'white');fade.addColorStop(.75,'white');fade.addColorStop(1,'transparent');
    ec.fillStyle=fade;ec.fillRect(-2,-2,4,4);
    ctx.drawImage(eyeCanvas,0,0);wakingEye=R.tex(canvas,null,true);
  }
  canvas.width=canvas.height=0;
  return {w,h,eye,nose,mouth,polar,wakingEye};
}
function transformProfile(profile, matrix, set, live, out) {
  const p = profile.rest, count = profile.bones.length;
  const matrices = live ? profile.bones.map(b => mul(matrix, set.bones[b].w)) : null;
  for (let k = 0; k < p.length; k += 2) {
    const x = p[k], y = p[k + 1];
    if (!live) {
      out[k] = matrix[0]*x + matrix[2]*y + matrix[4];
      out[k + 1] = matrix[1]*x + matrix[3]*y + matrix[5];
      continue;
    }
    let sx = 0, sy = 0;
    for (let b = 0; b < count; b++) {
      const w = profile.weights[(k / 2) * count + b];
      if (!w) continue;
      const m = matrices[b];
      sx += w * (m[0]*x + m[2]*y + m[4]); sy += w * (m[1]*x + m[3]*y + m[5]);
    }
    out[k] = sx; out[k + 1] = sy;
  }
}
// 上臂和前臂绕同一个肘关节转，手腕向前迈时仍保留胳膊原有的粗细。
function elbowWarp(shoulder, elbow, foot, target, handed){
  const length=(p,q)=>Math.hypot(q[0]-p[0],q[1]-p[1]);
  const a=length(shoulder,elbow), b=length(elbow,foot);
  const dx=target[0]-shoulder[0],dy=target[1]-shoulder[1], dist=Math.hypot(dx,dy);
  if(Math.min(a,b,dist)<.01) return null;
  const ux=dx/dist, uy=dy/dist, along=Math.min(a,Math.max(0,(a*a-b*b+dist*dist)/(2*dist)));
  // 即使一条腿向前探到最远，手肘也留一点后弯。
  const bend=Math.max(Math.sqrt(Math.max(0,a*a-along*along)),.13*Math.min(a,b));
  const joint=[shoulder[0]+ux*along-handed*uy*bend,shoulder[1]+uy*along+handed*ux*bend];
  function segment(p,q,u,v){
    const l=length(p,q),n=length(u,v),x=(q[0]-p[0])/l,y=(q[1]-p[1])/l;
    const X=(v[0]-u[0])/n,Y=(v[1]-u[1])/n,s=n/l;
    const m=[s*X*x+Y*y,s*Y*x-X*y,s*X*y-Y*x,s*Y*y+X*x];
    return [...m,u[0]-m[0]*p[0]-m[2]*p[1],u[1]-m[1]*p[0]-m[3]*p[1]];
  }
  return [segment(shoulder,elbow,shoulder,joint),segment(elbow,foot,joint,target)];
}
const hand = m => Math.sign(m[0] * m[3] - m[1] * m[2]) || 1;
const headBase = (s, m, live) => mul(live ? mul(m, s.bones.head.w) : m, s.HL);
function headMatrix(A, B, progress, MA, MB, options = {}) {
  if (options.curl) {
    const f=curlHead(A,B,progress,MA,MB,options);
    const p=[A.eye,A.nose,A.facePoints?.mouthHold || [A.headW*.77,A.headH*.87]];
    const current=[f.eye,f.nose,f.mouth];
    const [x,y]=p[0], ux=p[1][0]-x, uy=p[1][1]-y, vx=p[2][0]-x, vy=p[2][1]-y, det=ux*vy-uy*vx;
    const ax=current[1][0]-current[0][0], ay=current[1][1]-current[0][1], bx=current[2][0]-current[0][0], by=current[2][1]-current[0][1];
    const a=(ax*vy-bx*uy)/det,b=(ay*vy-by*uy)/det,c=(bx*ux-ax*vx)/det,d=(by*ux-ay*vx)/det;
    return [a,b,c,d,current[0][0]-a*x-c*y,current[0][1]-b*x-d*y];
  }
  const w = options.head ?? progress;
  const a = headBase(A, MA, options.fromLive), b = headBase(B, MB, options.toLive);
  const pa = ap(a, ...A.eye), pb = ap(b, ...B.eye);
  const a0 = Math.atan2(a[1], a[0]), a1 = Math.atan2(b[1], b[0]);
  const angle = a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) * w;
  const ca = Math.cos(angle), sa = Math.sin(angle), h = hand(MA);
  const sx = mix(Math.hypot(a[0], a[1]), Math.hypot(b[0], b[1]), w);
  const sy = h * mix(Math.hypot(a[2], a[3]), Math.hypot(b[2], b[3]), w);
  const lift = options.headLift || 0;
  const forward=(options.headForward || 0)*(A.mirror?-1:1);
  const ex = mix(pa[0], pb[0], w) - MA[2]*lift + MA[0]*forward;
  const ey = mix(pa[1], pb[1], w) - MA[3]*lift + MA[1]*forward;
  const m = [ca*sx, sa*sx, -sa*sy, ca*sy, ex, ey];
  const H = mul(m, Tm(-A.eye[0], -A.eye[1]));
  if (!options.headAngle) return H;
  const x = A.headW * .35, y = A.headH * .72;
  return mul(H, mul(Tm(x,y), mul(Rm(options.headAngle), Tm(-x,-y))));
}

function curlHead(A,B,progress,MA,MB,options) {
  const t=options.head ?? progress,a=headBase(A,MA,options.fromLive),b=headBase(B,MB,options.toLive);
  const pa=A.layers.find(l=>l.id==='head').profile,pb=B.layers.find(l=>l.id==='head').profile;
  const between=(xa,xb)=>{const x=ap(a,...xa),y=ap(b,...xb);return [mix(x[0],y[0],t),mix(x[1],y[1],t)];};
  const eye=between(pa.eye,pb.eye), lift=options.headLift || 0, angle=(options.headAngle || 0)*hand(MA);
  const pivot=between([A.headW*.4,A.headH*.74],[B.headW*(B.mirror?.6:.4),B.headH*.74]);
  const offset=mul(Tm(pivot[0]-MA[2]*lift,pivot[1]-MA[3]*lift),mul(Rm(angle),Tm(-pivot[0],-pivot[1])));
  return {a,b,t,offset,eye:ap(offset,...eye),nose:ap(offset,...between(pa.nose,pb.nose)),mouth:ap(offset,...between(pa.mouth,pb.mouth))};
}

// 三幅原画使用同一张按双眼、鼻梁和嘴定位的网格。耳朵也画进各自的侧脸，
// 近耳转到外侧、远耳从另一边露出；不让一只耳朵横穿眼睛。
const faceBands=[0,.12,.24,.32,.36,.42,.48,.52,.57,.62,.66,.70,.74,.78,.82,.9,1];
const faceColumns=[0,.10,.20,.32,.42,.50,.58,.68,.80,.90,1];
const portraitIndices=new Uint16Array((faceBands.length-1)*(faceColumns.length-1)*6);
for(let row=0,i=0;row<faceBands.length-1;row++)for(let col=0;col<faceColumns.length-1;col++){
  const a=row*faceColumns.length+col,b=a+1,c=a+faceColumns.length;
  portraitIndices.set([a,b,c+1,a,c+1,c],i);i+=6;
}
function interpolateStop(x,stops,values) {
  let i=1;while(i<stops.length-1 && x>stops[i])i++;
  return mix(values[i-1],values[i],unit((x-stops[i-1])/(stops[i]-stops[i-1])));
}
function mappedPortrait(R,canvas,features,box,dynamic=false) {
  const {left,right,nose,mouth}=features,points=[],uv=[];
  const margin=Math.ceil(Math.max(canvas.width,canvas.height)*.14);
  const padded=document.createElement('canvas');padded.width=canvas.width+margin*2;padded.height=canvas.height+margin*2;
  const pc=padded.getContext('2d',{willReadFrequently:true});
  for(const v of faceBands)for(const u of faceColumns){
    const eyeY=mix(left[1],right[1],unit((u-.32)/.36));
    const y=interpolateStop(v,[0,.42,.66,.82,1],[0,eyeY,nose[1],mouth[1],1]);
    const lo=-.05,hi=1.05,base=mix(lo,hi,u),span=hi-lo;
    const at=xs=>Math.max(lo+span*.005,Math.min(hi-span*.005,xs));
    const eyeX=interpolateStop(u,[0,.20,.32,.42,.58,.68,.8,1],
      [lo,at(left[0]-left[2]),at(left[0]),at(left[0]+left[2]),at(right[0]-right[2]),at(right[0]),at(right[0]+right[2]),hi]);
    const noseX=interpolateStop(u,[0,.32,.42,.5,.58,.68,1],
      [lo,at(nose[0]-nose[2]*2),at(nose[0]-nose[2]),at(nose[0]),at(nose[0]+nose[2]),at(nose[0]+nose[2]*2),hi]);
    const mouthX=interpolateStop(u,[0,.5,1],[lo,at(mouth[0]),hi]);
    const x=interpolateStop(v,[0,.24,.42,.52,.66,.74,.82,1],[base,eyeX,eyeX,mix(eyeX,noseX,.45),noseX,noseX,mouthX,base]);
    uv.push((x*canvas.width+margin)/padded.width,(y*canvas.height+margin)/padded.height);points.push(box.x+x*box.w,box.y+y*box.h);
  }
  const mesh=R.bufs({part:'head',idx:portraitIndices,uv:new Float32Array(uv),pos:new Float32Array(uv.length)});
  let tex;
  function releaseCanvases(){
    padded.width=padded.height=0;
    if(canvas instanceof HTMLCanvasElement)canvas.width=canvas.height=0;
  }
  function upload(){
    pc.clearRect(0,0,padded.width,padded.height);pc.drawImage(canvas,margin,margin);
    tex=R.tex(padded,tex,true);
    if(!dynamic)releaseCanvases();
    return tex;
  }
  return {mesh,points,box,upload,texture:()=>tex||upload(),dispose(){
    if(tex)R.gl.deleteTexture(tex);
    for(const buffer of [mesh.pb,mesh.ub,mesh.ib])R.gl.deleteBuffer(buffer);
    releaseCanvases();
  }};
}
function faceView(R,set,head,ear,kit,frontImage) {
  const h=head.layer,e=ear.layer,dx=e.x-h.x,dy=e.y-h.y;
  const x=Math.min(0,dx),y=Math.min(0,dy),w=Math.max(h.w,dx+e.w)-x,hg=Math.max(h.h,dy+e.h)-y;
  const box={x,y,w,h:hg},scale=head.image.width/h.w;
  const make=(w,h)=>{const c=document.createElement('canvas');c.width=Math.ceil(w);c.height=Math.ceil(h);return c;};
  let result;
  const get=() => {
    if(result)return result;
    const canvas=make(w*scale,hg*scale),ctx=canvas.getContext('2d',{willReadFrequently:true});
    const redraw=im=>{
      ctx.setTransform(canvas.width/w,0,0,canvas.height/hg,-x*canvas.width/w,-y*canvas.height/hg);
      ctx.clearRect(x,y,w,hg);ctx.drawImage(im,0,0,h.w,h.h);ctx.drawImage(ear.image,dx,dy,e.w,e.h);
    };
    redraw(head.image);
    const uv=(p,extent)=>[(p[0]-x)/w,(p[1]-y)/hg,extent*h.w/w];
    const viewRight=set.name==='prone';
    const far=viewRight?[set.eye[0]+h.w*.138,set.eye[1]-h.h*.055]:[set.eye[0]-h.w*.247,set.eye[1]-h.h*.134];
    const nearEye=uv(set.eye,viewRight?.082:.072),farEye=uv(far,viewRight?.008:.051);
    result=mappedPortrait(R,canvas,{left:viewRight?nearEye:farEye,right:viewRight?farEye:nearEye,
      nose:uv(set.nose,viewRight?.053:.065),mouth:uv(set.facePoints?.mouthHold||[h.w*.67,h.h*.85],0)},box,!!(set.faceKit && kit));
    if(set.faceKit && kit){
      let uploaded,texture;
      result.texture=face=>{
        const image=kit.faceImage(face);
        if(uploaded!==kit.faceRevision){redraw(image);texture=result.upload();uploaded=kit.faceRevision;}
        return texture;
      };
    }
    if(set.name==='curl'){
      const flip=p=>[1-p[0],p[1],p[2]];
      const rightFeatures={left:flip(nearEye),right:flip(farEye),nose:flip(uv(set.nose,.065)),mouth:flip(uv(set.facePoints.mouthHold,0))};
      const side=make(canvas.width,canvas.height),sc=side.getContext('2d',{willReadFrequently:true});
      sc.translate(side.width,0);sc.scale(-1,1);sc.drawImage(canvas,0,0);
      result.opposite=mappedPortrait(R,side,rightFeatures,{x:0,y:0,w:1,h:1});


      if(frontImage){
        const features={left:[.383,.425,.066],right:[.681,.399,.064],nose:[.556,.622,.069],mouth:[.56,.79]};
        result.front=mappedPortrait(R,frontImage,features,{x:0,y:0,w:1,h:1});
      }

    }
    return result;
  };
  get.release=()=>{
    if(!result)return;
    result.front?.dispose();result.opposite?.dispose();result.dispose();
    result=null;
  };
  return get;
}
function drawFrontSweep(R,A,B,H,kit,face,parts) {
  const a=A.faceView(),b=B.faceView(),t=H.t;
  // 旧包没有独立朝前头图时，沿两张完整的斜侧脸转过去，保留原画的眼鼻和耳尖。
  const views=b.front?[a,b.opposite,b.front,b]:[a,b.opposite,b];
  const stops=b.front?[0,.32,.57,1]:[0,.36,1];
  const index=t<=stops[1]?0:views.length===3||t<=stops[2]?1:2;
  const source=views[index],dest=views[index+1],f=unit((t-stops[index])/(stops[index+1]-stops[index]));
  const ma=mul(H.offset,H.a),mb=mul(H.offset,H.b),verts=source.mesh.pos;
  const point=(view,phase,k)=>{
    if(view===a)return ap(ma,a.points[k],a.points[k+1]);
    if(view===b)return ap(mb,b.points[k],b.points[k+1]);
    const x=(view.points[k]-.5)*(view===b.front?1.06:1)+.5,y=(view.points[k+1]-.5)*.92+.5;
    const lhs=ap(ma,a.box.x+a.box.w*x,a.box.y+a.box.h*y),rhs=ap(mb,b.box.x+b.box.w*x,b.box.y+b.box.h*y);
    return [mix(lhs[0],rhs[0],phase),mix(lhs[1],rhs[1],phase)];
  };
  const ear=[Infinity,Infinity,-Infinity,-Infinity];
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let k=0;k<verts.length;k+=2){
    const start=point(source,stops[index],k),end=point(dest,stops[index+1],k);
    const xx=mix(start[0],end[0],f),yy=mix(start[1],end[1],f);
    const row=Math.floor(k/2/faceColumns.length),u=faceColumns[(k/2)%faceColumns.length];
    if(faceBands[row]>=.24 && (t<.57 ? u<=.2 : u>=.8)){
      ear[0]=Math.min(ear[0],xx);ear[1]=Math.min(ear[1],yy);
      ear[2]=Math.max(ear[2],xx);ear[3]=Math.max(ear[3],yy);
    }
    verts[k]=xx;verts[k+1]=yy;x0=Math.min(x0,xx);y0=Math.min(y0,yy);x1=Math.max(x1,xx);y1=Math.max(y1,yy);
  }
  R.drawMatched(source.mesh,dest.mesh,source.texture(face),dest.texture(face),f<.5?0:1,1);
  parts.head=[x0,y0,x1,y1];parts.ear=ear;
}

function drawTurningHead(R,A,B,a,b,H,kit,face,parts) {
  const p=a.profile,q=b.profile,t=H.t, yaw=A.name==='prone';
  const m1=mul(H.offset,H.a),m2=mul(H.offset,H.b);
  const updateUV=mesh=>{
    const gl=R.gl; gl.bindBuffer(gl.ARRAY_BUFFER,mesh.ub); gl.bufferSubData(gl.ARRAY_BUFFER,0,mesh.uv);
  };
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;

  const texture=(S,L)=>S.faceKit ? kit.curvedFace(face) : L.profile.wakingEye && face.eye!=='closed' ? L.profile.wakingEye : L.tex;
  if (yaw) { drawFrontSweep(R,A,B,H,kit,face,parts); return; } else {
    // 卷到一半和熟睡的侧脸朝向相同。整个头按眼睛和鼻尖对齐，鼻翼、口鼻比例始终刚性保持。
    const poseMatrix=(M,prof)=>{
      const e=ap(M,...prof.eye),n=ap(M,...prof.nose);
      const vx=n[0]-e[0],vy=n[1]-e[1],wx=H.nose[0]-H.eye[0],wy=H.nose[1]-H.eye[1];
      const den=vx*vx+vy*vy, c=(wx*vx+wy*vy)/den, s=(wy*vx-wx*vy)/den;
      return mul([c,s,-s,c,H.eye[0]-c*e[0]+s*e[1],H.eye[1]-s*e[0]-c*e[1]],M);
    };
    const ta=poseMatrix(m1,p),tb=poseMatrix(m2,q),P=p.polar,Q=q.polar, verts=P.mesh.pos;
    for(let j=0,k=0;j<=P.dirs;j++){
      const ra=P.radii[j],rb=Q.radii[j],core=.85*Math.min(ra,rb);
      for(let r=0;r<=P.rings;r++,k+=2){
        const f=r/P.rings, da=f<=.75?core*f/.75:mix(core,ra,(f-.75)/.25),db=f<=.75?core*f/.75:mix(core,rb,(f-.75)/.25);
        const x=p.eye[0]+da*P.axes[j][0],y=p.eye[1]+da*P.axes[j][1],xx=q.eye[0]+db*Q.axes[j][0],yy=q.eye[1]+db*Q.axes[j][1];
        P.mesh.uv[k]=x/p.w;P.mesh.uv[k+1]=y/p.h; Q.mesh.uv[k]=xx/q.w;Q.mesh.uv[k+1]=yy/q.h;
        verts[k]=mix(ta[0]*x+ta[2]*y+ta[4],tb[0]*xx+tb[2]*yy+tb[4],t);
        verts[k+1]=mix(ta[1]*x+ta[3]*y+ta[5],tb[1]*xx+tb[3]*yy+tb[5],t);
        x0=Math.min(x0,verts[k]);x1=Math.max(x1,verts[k]);y0=Math.min(y0,verts[k+1]);y1=Math.max(y1,verts[k+1]);
      }
    }
    updateUV(P.mesh);updateUV(Q.mesh);
    R.drawMatched(P.mesh,Q.mesh,texture(A,a),texture(B,b),t<.53?0:1,1);
  }
  parts.head=[x0,y0,x1,y1];
}

function prepare(R, sets) {
  const ids = ['tail','hind-leg-far','front-leg-far','body','hind-leg-near','front-leg-near','head','ear'];
  const partsBySet = new Map();
  for (const name of poseNames) {
    const set = sets[name];
    if (!set) continue;
    const byId = Object.fromEntries(set.layers.map(layer => [layer.id, layer]));
    if (!ids.every(id => id === 'head' ? byId.head?.tex : byId[id]?.profile)) continue;
    partsBySet.set(set, byId);
  }
  const supports=keys=>keys.every(name=>partsBySet.has(sets[name]) && sets[name].faceKit);
  const canRise=supports(['prone','lie-down','crouch','stand']);
  const canCurl=['prone','curl','sleep'].every(name => partsBySet.get(sets[name])?.head.profile);
  if (!canRise && !canCurl && !supports(['stand','crouch','sit']) && !supports(['sit','lie-down','prone'])) return null;
  const screenA = new Float32Array(positions), screenB = new Float32Array(positions);
  const pigment = new Float32Array(positions/2);
  function draw(A, B, progress, MA, MB, kit, face, parts, options = {}) {
    const layersA = partsBySet.get(A), layersB = partsBySet.get(B);
    const front = options.front ?? progress, rear = options.rear ?? progress, head = options.head ?? front;
    const curled=!!options.curl;
    const H=curled ? curlHead(A,B,progress,MA,MB,options) : null;
    const MH = curled ? null : headMatrix(A, B, progress, MA, MB, options);
    // 让耳根随头部抬起，并保留上一个姿势仍在进行的竖耳动作。
    const baseA = headBase(A, MA, options.fromLive), baseB = headBase(B, MB, options.toLive);
    const earLocal = (s,m,live) => {
      const bind = s.HL, root = s.lm.earRoot, dx = root[0]-bind[4], dy = root[1]-bind[5];
      const det = bind[0]*bind[3]-bind[1]*bind[2];
      const x = (bind[3]*dx-bind[2]*dy)/det, y = (-bind[1]*dx+bind[0]*dy)/det;
      const screen = ap(live ? mul(m, s.bones.ear0.w) : m, ...root);
      return {x, y, screen};
    };
    const eA = earLocal(A,MA,options.fromLive), eB = earLocal(B,MB,options.toLive);
    const anchor = curled ? ap(H.offset,mix(eA.screen[0],eB.screen[0],head),mix(eA.screen[1],eB.screen[1],head)) : ap(MH, mix(eA.x,eB.x,head), mix(eA.y,eB.y,head));
    const atA = ap(baseA,eA.x,eA.y), atB = ap(baseB,eB.x,eB.y);
    if (!curled) {
      anchor[0] += mix(eA.screen[0]-atA[0], eB.screen[0]-atB[0], head);
      anchor[1] += mix(eA.screen[1]-atA[1], eB.screen[1]-atB[1], head);
    }
    const earAngle = ((options.headAngle || 0) + (options.earLag || 0)) * Math.PI / 180 * hand(MA);
    const ca = Math.cos(earAngle), sa = Math.sin(earAngle);
    function paint(id, alpha = 1, distal = 1) {
      if (!alpha) return;
      const a = layersA[id], b = layersB[id];
      const stride=!curled && a.profile?.stride && b.profile?.stride;
      const p = stride ? a.profile.stride : a.profile, q = stride ? b.profile.stride : b.profile;
      if (id === 'head') {
        if (!curled) {root.PetRig.drawHead(R, A, kit, MH, face, parts, a.tex); return;}
        drawTurningHead(R,A,B,a,b,H,kit,face,parts); return;
      }
      transformProfile(p, MA, A, options.fromLive, screenA);
      transformProfile(q, MB, B, options.toLive, screenB);
      const n = legs[id], f = n && n[0] === 'f';
      const isEar = id === 'ear', isBody = id === 'body';
      const t = isEar ? head : id==='tail' ? options.tail ?? rear : f ? front : rear;
      const out = p.mesh.pos;
      const sweep=curled && id==='tail' && A.name==='prone';
      let curledTail;
      if(sweep){
        // 尾尖使用同一幅完整毛纹的形状；尾根在臀后弯曲，连续接到正在换重心的躯干。
        const markers=(set,m,live)=>[
          ap(live?mul(m,set.bones.tail0.w):m,...set.lm.tail),
          ap(live?mul(m,set.bones.tail2.w):m,...set.lm.tailTip)
        ];
        const [ra,ta]=markers(A,MA,options.fromLive),[rb,tb]=markers(B,MB,options.toLive);
        const lhs=t<.54,pose=lhs?screenA:screenB,root=lhs?ra:rb,tip=lhs?ta:tb;
        const depth=Math.sin(t*Math.PI),sx=1-.46*depth,sy=1-.32*depth;
        const tx=mix(ta[0],tb[0],t)-MA[0]*A.headW*.19*depth;
        const ty=mix(mix(ta[1],tb[1],t),ap(MA,A.ax,A.ground-A.headH*.36)[1],depth*.9);
        const dx=mix(ra[0],rb[0],t)-(tx+(root[0]-tip[0])*sx);
        const dy=mix(ra[1],rb[1],t)-(ty+(root[1]-tip[1])*sy);
        curledTail=(k)=>{
          const v=Math.floor(k/2/(columns+1))/rows,bind=1-smooth(v/.61);
          return [tx+(pose[k]-tip[0])*sx+dx*bind,ty+(pose[k+1]-tip[1])*sy+dy*bind];
        };
      }
      let offX = 0, offY = 0, arm=null, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      if (n) {
        const fa = A.legs[n].ft, fb = B.legs[n].ft;
        const sa = ap(options.fromLive ? mul(MA,A.bones[n+'L'].w) : MA, ...fa);
        const sb = ap(options.toLive ? mul(MB,B.bones[n+'L'].w) : MB, ...fb);
        const dest = options.paws?.[n];
        let target;
        if (dest) target = ap(MA, ...fromRel(A, dest));
        else {
          const foot = options.feet?.[n] ?? t, lift = options.lift?.[n] || 0;
          target = [mix(sa[0],sb[0],foot)-MA[2]*lift,mix(sa[1],sb[1],foot)-MA[3]*lift];
        }
        offX = target[0] - mix(sa[0],sb[0],t); offY = target[1] - mix(sa[1],sb[1],t);
        if (((options.articulateFront && f) || (options.foldHind && !f)) && Math.hypot(offX,offY)>.015){
          const upperA=options.fromLive?mul(MA,A.bones[n+'U'].w):MA;
          const upperB=options.toLive?mul(MB,B.bones[n+'U'].w):MB;
          const pt=(key)=>{
            const u=ap(upperA,...A.legs[n][key]),v=ap(upperB,...B.legs[n][key]);
            return [mix(u[0],v[0],t),mix(u[1],v[1],t)];
          };
          arm=elbowWarp(pt('pv'),pt('jt'),[mix(sa[0],sb[0],t),mix(sa[1],sb[1],t)],target,hand(MA));
        }
      }
      for (let k = 0; k < out.length; k += 2) {
        let w = t;
        if (isBody) {
          const span = A.lm.chest[0] - A.lm.hip[0];
          w = mix(rear, front, smooth((p.rest[k] - A.lm.hip[0]) / (span || 1)));
        }
        let x = mix(screenA[k],screenB[k],w), y = mix(screenA[k+1],screenB[k+1],w);
        if (arm) {
          const v=mix(p.weights[k+1],q.weights[k+1],w),a=arm[0],b=arm[1],ox=x,oy=y;
          x=mix(a[0]*ox+a[2]*oy+a[4],b[0]*ox+b[2]*oy+b[4],v);
          y=mix(a[1]*ox+a[3]*oy+a[5],b[1]*ox+b[3]*oy+b[5],v);
          if (options.foldHind && !f) {
            // 膝在两节腿之间折。大腿根留在髋上，脚掌平放在已有的落点。
            const ga=A.legs[n],gb=B.legs[n],ya=p.rest[k+1],yb=q.rest[k+1];
            const thigh=(g,y)=>smooth((y-g.pv[1])/Math.max(1,g.jt[1]-g.pv[1])/.70);
            const pad=(g,y)=>smooth(((y-g.jt[1])/Math.max(1,g.ft[1]-g.jt[1])-.46)/.35);
            const bend=mix(thigh(ga,ya),thigh(gb,yb),w),sole=mix(pad(ga,ya),pad(gb,yb),w);
            x=mix(mix(ox,x,bend),ox+offX,sole);
            y=mix(mix(oy,y,bend),oy+offY,sole);
          }
        } else if (n) {
          const weight = mix(footWeight(A.legs[n],p.rest[k+1]),footWeight(B.legs[n],q.rest[k+1]),w);
          x += offX * weight; y += offY * weight;
        } else if (curled && isBody && (options.headLift || options.headAngle)) {
          const neck=(s,profile)=>{
            const x=profile.rest[k],y=profile.rest[k+1],hip=s.lm.hip,chest=s.lm.chest;
            return smooth(((x-hip[0])/(chest[0]-hip[0])-.4)/.6)*smooth((chest[1]-y)/(s.headH*.34));
          };
          const follow=mix(neck(A,p),neck(B,q),w),nx=H.offset[0]*x+H.offset[2]*y+H.offset[4],ny=H.offset[1]*x+H.offset[3]*y+H.offset[5];
          x=mix(x,nx,follow);y=mix(y,ny,follow);
        } else if (sweep){
          [x,y]=curledTail(k);
        } else if (isEar) {
          const dx = x - mix(eA.screen[0], eB.screen[0], head), dy = y - mix(eA.screen[1],eB.screen[1],head);
          const sweep=curled && A.name==='prone' ? Math.sin(Math.PI*head) : 0;
          x = anchor[0] + (ca*dx - sa*dy)*(1+.16*sweep); y = anchor[1] + sa*dx + ca*dy;
        }
        out[k] = x; out[k+1] = y;
        if (!curled && (isBody || n)) {
          // 斑块沿同一表面逐段交接。任一截面只在很窄的边界混合，胸和臀不会叠出两条线。
          const slice=Math.floor(k/2/(columns+1))/rows;
          const boundary=smooth((t-(.27+.44*slice))/.045);
          // 大腿根在站坐图里本就有一圈渐隐的短毛，而趴图画着完整的腿根。
          // 这一小片和身上的棕毛一起接上；别让截面的分界在臀部画出一道横线。
          pigment[k/2]=n && n[0]==='h'
            ? mix(smooth((t-.21)/.60),boundary,smooth((slice-.39)/.25))
            : boundary;
        }
        x0 = Math.min(x0,x); y0 = Math.min(y0,y); x1 = Math.max(x1,x); y1 = Math.max(y1,y);
      }
      const idx=p.mesh.idx;
      if (distal<1) p.mesh.idx=idx.subarray(0,Math.ceil(rows*distal)*columns*6);
      const blend=sweep?(t<.54?0:1):curled?smooth((t-.25)/.5):id==='tail'?(t<.52?0:1):t;
      R.drawMatched(p.mesh,q.mesh,a.tex,b.tex,blend,alpha,!curled&&(isBody||n)?pigment:null);
      p.mesh.idx=idx;
      parts[id] = [x0,y0,x1,y1];
    }
    // 趴姿的近侧前腿被胸口遮住；撑地时臂部从胸前露出。
    const frontDepth = mix(A.name === 'prone' ? 0 : 1, B.name === 'prone' ? 0 : 1, smooth(front));
    if (curled) {
      // 尾根从臀后绕出。白尖从最外沿先越过后爪，随后整条尾巴卧在前腿旁。
      const tailPhase=options.tail ?? rear, tipLength=A.name==='prone' ? (.36*smooth(tailPhase/.48)+.64*smooth((tailPhase-.60)/.40)) : 1;
      if (tipLength<1) paint('tail');
      paint('hind-leg-far');paint('front-leg-far');
      if (frontDepth<1) paint('front-leg-near');
      paint('body');paint('hind-leg-near');paint('front-leg-near',frontDepth);
      if(tipLength>0)paint('tail',1,tipLength);
      paint('head');if(A.name!=='prone')paint('ear');
      return parts;
    }
    for (const id of ids) {
      if (id === 'body' && frontDepth < 1) paint('front-leg-near');
      // 前腿一直延伸到胸下。上层只负责胸前的深度过渡，避免逐行裁断一条实色腿。
      if (id !== 'front-leg-near') paint(id);
      else if(frontDepth>0) paint(id,smooth((frontDepth-.55)/.45));
    }
    return parts;
  }
  function landmarks(A,B,u,MA,MB,options) {
    const H=curlHead(A,B,u,MA,MB,options), t=options.tail ?? u;
    const tail=(id,k)=>{
      const pos=(s,m,live)=>ap(live ? mul(m,s.bones[id==='tail'?'tail0':'tail2'].w) : m,...s.lm[id]);
      const a=pos(A,MA,options.fromLive),b=pos(B,MB,options.toLive);
      const x=mix(a[0],b[0],t), y=mix(a[1],b[1],t);
      return A.name==='prone' ? tailSweep(x,y,k,t,A,MA) : [x,y];
    };
    return {eye:H.eye,nose:H.nose,tailRoot:tail('tail',0),tailTip:tail('tailTip',positions-2)};
  }
  return { draw, headMatrix, landmarks, canCurl, canRise, supports };
}
// 尾尖从身体背后向镜头扫过，再绕到爪边，投影最短时贴近地面。
function tailSweep(x,y,k,t,A,MA) {
  const v=Math.floor(k/2/(columns+1))/rows, depth=Math.sin(Math.PI*t);
  const floor=ap(MA,A.ax,A.ground-A.headH*.36)[1];
  return [x-MA[0]*A.headW*.19*depth*v,mix(y,floor,depth*.9*v)];
}
function footWeight(g, y) { return smooth(((y - g.pv[1]) / (g.ft[1] - g.pv[1] || 1) - .12) / .77); }
root.PetRiseMotion = { profile, headProfile, faceView, prepare };
root.PetTransitions = root.PetRiseMotion;
})(typeof self !== 'undefined' ? self : this);
