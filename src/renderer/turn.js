// 从侧面经背面转到另一侧。每个水平截面有自己的半径，侧身变窄时仍能看见圆润的后脑和臀部。
(function(root){
'use strict';
const slices = 24, rows = 36, stride = slices + 1;
const mix = (a,b,t) => a + (b-a)*t;
const clamp = x => Math.max(0,Math.min(1,x));
const smooth = x => {const t=clamp(x);return t*t*(3-2*t);};
const {ap,mul,Tm,Rm,Sm}=root.PetRig;
const legNames={'hind-leg-far':'hf','front-leg-far':'ff','hind-leg-near':'hn','front-leg-near':'fn'};
// 先把远后爪让到臀的另一边，再伸近前爪。近后爪继续承重到第二步。
const steps={hf:[0,.29,.45,.63],fn:[.04,.36,.47,.69],ff:[.19,.48,.65,.94],hn:[.28,.51,.76,1]};

// 只缓存轮廓；尾巴、四肢和头部始终使用原画的颜色。
function contour(name,layer,image,pixels){
  if(name!=='stand' && name!=='turn-back')return null;
  const w=image.width,h=image.height,out=new Float32Array((rows+1)*2);
  for(let j=0;j<=rows;j++){
    const center=j*h/rows,radius=Math.ceil(h/rows/2);
    let lo=w,hi=-1;
    for(let y=Math.max(0,Math.floor(center-radius));y<Math.min(h,Math.ceil(center+radius)+1);y++){
      for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>16){lo=Math.min(lo,x);hi=Math.max(hi,x);}
    }
    if(hi<lo){lo=hi=w*.5;}
    out[2*j]=Math.max(0,lo-1)/w; out[2*j+1]=Math.min(w,hi+2)/w;
  }
  const section={rows:out,x:layer.x,y:layer.y,w:layer.w,h:layer.h};
  if(name==='stand' && layer.id==='tail' && layer.chain?.length>1)section.tail=tailStrips(layer,image,pixels);
  if(layer.id==='body'){
    // 脊线和腹线一一对应。背视原画的下端含有被腿遮住的裁口，不能把它横拉成腹部。
    const columns=[];
    for(let i=0;i<=slices;i++){
      const u=(1-Math.cos(Math.PI*i/slices))/2;
      let top=0,bottom=0,count=0;
      const cx=Math.round(u*(w-1)),radius=Math.max(1,Math.round(w*.006));
      for(let x=Math.max(0,cx-radius);x<=Math.min(w-1,cx+radius);x++){
        let lo=0,hi=h-1;
        while(lo<h && pixels[(lo*w+x)*4+3]<160)lo++;
        while(hi>lo && pixels[(hi*w+x)*4+3]<160)hi--;
        if(lo<h){top+=lo;bottom+=hi+1;count++;}
      }
      columns.push({u,top:count?top/(count*h):.65,bottom:count?bottom/(count*h):.65});
    }
    section.columns=columns;
  }
  return section;
}
// 沿尾根到白尖的斜轴切片。竖切弯起的白尖会把同一束毛分到两条相反的折线上。
function tailStrips(layer,image,pixels){
  const w=image.width,h=image.height,root=layer.chain[0],tip=layer.chain.at(-1);
  const dx=(tip[0]-root[0])*w/layer.w,dy=(tip[1]-root[1])*h/layer.h,length=Math.hypot(dx,dy);
  if(!length)return null;
  const ux=dx/length,uy=dy/length,ox=uy,oy=-ux,bias=Math.ceil(Math.hypot(w,h))+2;
  const low=new Float32Array(2*bias+1).fill(Infinity),high=new Float32Array(low.length).fill(-Infinity);
  let first=low.length,last=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    if(pixels[4*(y*w+x)+3]<18)continue;
    const a=Math.round((x+.5)*ux+(y+.5)*uy)+bias,b=(x+.5)*ox+(y+.5)*oy;
    first=Math.min(first,a);last=Math.max(last,a);low[a]=Math.min(low[a],b);high[a]=Math.max(high[a],b);
  }
  if(first>=last)return null;
  const n=48,rest=new Float32Array((n+1)*10),uv=new Float32Array(rest.length),idx=new Uint16Array(n*4*6);
  const pad=Math.ceil((last-first)/n/2);
  let lastCenter=(low[first]+high[first])/2;
  for(let j=0,k=0;j<=n;j++){
    const s=mix(first-1,last+1,j/n),q=Math.round(s);
    let lo=Infinity,hi=-Infinity;
    for(let a=Math.max(first,q-pad);a<=Math.min(last,q+pad);a++){
      lo=Math.min(lo,low[a]);hi=Math.max(hi,high[a]);
    }
    if(hi<lo)lo=hi=lastCenter;
    else lastCenter=(lo+hi)/2;
    for(let i=0;i<5;i++,k+=2){
      const b=mix(lo-1.5,hi+1.5,i/4),u=((s-bias)*ux+b*ox)/w,v=((s-bias)*uy+b*oy)/h;
      uv[k]=u;uv[k+1]=v;rest[k]=layer.x+u*layer.w;rest[k+1]=layer.y+v*layer.h;
      if(j<n && i<4){const a=k/2;idx.set([a,a+1,a+6,a,a+6,a+5],(j*4+i)*6);}
    }
  }
  return {rest,uv,idx};
}
function angle(p,head){return Math.PI*smooth(head ? (p+.012)/.90 : (p-.04)/.92);}
function foot(set,n,p,backFoot){
  const point=set.legs[n].ft,x=point[0]-set.ax,H=set.restH;
  const z=backFoot ? backFoot[0]-set.ax-(n==='hn'?.032*H:0) : (n[1]==='n'?1:-1)*(n[0]==='h'?.135:.115)*H;
  const [a,b,c,d]=steps[n], one=smooth((p-a)/(b-a)),two=smooth((p-c)/(d-c));
  const lift=Math.sin(Math.PI*one)+Math.sin(Math.PI*two);
  const liftHeight=n==='fn'?.074:.051;
  return [set.ax + mix(mix(x,z,one),-x,two),
    mix(mix(point[1],backFoot?.[1] ?? point[1],one),point[1],two)-lift*H*liftHeight];
}
async function loadRear(R,pose){
  if(!pose)return null;
  const back={};
  for(const raw of pose.layers){
    const im=await root.PetRig.loadImage(raw.src),cv=document.createElement('canvas');
    cv.width=im.width;cv.height=im.height;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0);
    const hind=raw.id==='hind-leg-near'||raw.id==='hind-leg-far';
    if(hind){
      // 背面后爪原画带了一块地面。沿原画最外侧脚趾的棕色描线裁掉底色，保留承重位置。
      const far=raw.id==='hind-leg-far',scale=im.height/246;
      ctx.save();ctx.translate(far?im.width:0,im.height);ctx.scale(far?-scale:scale,scale);
      ctx.beginPath();ctx.moveTo(-4,-250);ctx.lineTo(130,-250);ctx.lineTo(130,-24);ctx.lineTo(109,-24);
      ctx.bezierCurveTo(109,-12,106,-7,98,-5.5);
      ctx.bezierCurveTo(89,-3,60,-3,52,-5.5);ctx.bezierCurveTo(44,-6,42,-12,40,-18);
      ctx.quadraticCurveTo(34,-18,30,-21);ctx.lineTo(-4,-21);ctx.closePath();
      ctx.globalCompositeOperation='destination-in';ctx.fill();ctx.restore();
    }
    const part=contour('turn-back',raw,im,ctx.getImageData(0,0,im.width,im.height).data);
    // 远侧肢体在躯干的阴影中；用原画的毛纹和不透明度保留脚掌的体积。
    const shade=raw.id==='front-leg-far'?.24:raw.id==='hind-leg-far'?.16:0;
    if(shade){
      ctx.globalCompositeOperation='source-atop';ctx.fillStyle='rgba(87,64,46,'+shade+')';
      ctx.fillRect(0,0,cv.width,cv.height);
    }
    part.tex=R.tex(hind||shade?cv:im,null,true);if(raw.foot)part.foot=[raw.x+raw.foot[0],raw.y+raw.foot[1]];
    back[raw.id]=part;cv.width=cv.height=1;
  }
  return back;
}
function prepare(R,stand,back){
  if(!stand || !back || stand.layers.some(l=>!l.turnSection))return null;
  let primary,cap,mask;
  const layers=Object.fromEntries(stand.layers.map(l=>[l.id,l]));
  function headPoint(M,lx,ly,p){
    const S=stand,H=S.restH,base=mul(S.bones.head.w,S.HL),pt=ap(base,lx,ly);
    const axis=ap(S.bones.head.w,...S.headP)[0],headAngle=angle(p,true);
    const si=Math.sin(headAngle),fall=si*si;
    const x=S.ax+(axis-S.ax)*Math.cos(angle(p,false))+(pt[0]-axis)*Math.cos(headAngle)-.012*H*si;
    const by=back.head.y+back.head.h*ly/S.headH;
    const y=mix(pt[1]+H*.025*Math.sin(Math.PI*p),by,fall);
    return ap(M,x,y);
  }
  function init(){
    const uv=new Float32Array((rows+1)*stride*2),idx=[];
    for(let j=0,k=0;j<=rows;j++)for(let i=0;i<=slices;i++,k+=2){
      uv[k]=i/slices;uv[k+1]=j/rows;
      const a=k/2;
      if(i<slices && j<rows)idx.push(a,a+1,a+stride+1,a,a+stride+1,a+stride);
    }
    const mesh=()=>R.bufs({uv:uv.slice(),pos:new Float32Array(uv.length),idx:new Uint16Array(idx)});
    primary=mesh();cap=mesh();mask=new Float32Array(uv.length);
  }
  function draw(M,kit,face,parts,p){
    if(!primary)init();
    const S=stand,H=S.restH,ax=S.ax,bodyAngle=angle(p,false),headAngle=angle(p,true);
    const bodySin=Math.sin(bodyAngle);
    // 每个部位只绘制一次；绘制顺序随深度改变。尾巴在侧身时藏在臀后，背面时位于近处。
    const bodyBounds=[];
    function paint(id){
      const layer=layers[id],sec=layer.turnSection,dst=back[id],leg=legNames[id];
      const head=id==='head',ear=id==='ear',tail=id==='tail';
      const theta=head||ear?headAngle:bodyAngle,co=Math.cos(theta),si=Math.sin(theta),around=si*si;
      const near=leg?leg[1]==='n':true;
      // 转过背面以后，镜头另一侧的耳朵和爪子成为近侧。
      const lateral=leg?(near?1:-1)*(leg[0]==='f'?.115:.135):ear?(near?1:-1)*.133:0;
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      const ft=leg&&foot(S,leg,p,dst.foot),restFt=leg&&S.legs[leg].ft;
      const axis=head||ear?ap(S.bones.head.w,...S.headP)[0]:ax;
      const B=S.bones,headM=mul(B.head.w,S.HL);
      const v=primary.pos;
      let rootInset=0;
      for(let j=0,k=0;j<=rows;j++){
        const f=j/rows,lo=sec.rows[j*2],hi=sec.rows[j*2+1],u=(lo+hi)/2;
        const sourceX=sec.x+sec.w*u,sourceY=sec.y+f*sec.h;
        const bone=head?null:ear?(f<.55?B.ear0:B.ear1):tail?B.tail0:leg?(f<.38?B[leg+'U']:B[leg+'L']):B.body;
        const center=head?ap(headM,u*S.headW,f*S.headH):ap(bone.w,sourceX,sourceY);
        const half=(hi-lo)*sec.w*.5;
        const arc=Math.sqrt(Math.max(0,Math.sin(Math.PI*f)));
        const cross=head?H*.180*arc:
          tail?Math.min(half,H*.044):ear?H*.068*arc:Math.min(half*1.05,H*.070);
        const bu=dst.rows[j*2],bv=dst.rows[j*2+1],br=(bv-bu)*dst.w*.5;
        const rearColor=smooth((si-.30)/.60);
        const width=mix(Math.hypot(half*co,cross*si),Math.hypot(half*co,br*si),rearColor);
        const local=head||ear?(axis-ax)*Math.cos(bodyAngle)+(center[0]-axis)*co:(center[0]-ax)*co;
        // 保持同侧腿的轨迹连续，过背面时左右腿交接绘制顺序，而非瞬时换位。
        let cx=ax+local+lateral*H*si,cy=center[1];
        if(head||ear){cx-=.012*H*si;cy+=H*.025*Math.sin(Math.PI*p);}
        if(head)cy=mix(cy,S.ground-H*(.975-.425*f),around);
        if(ear){
          cx+=lateral*H*.22*Math.sin(Math.PI*f)*si;
          cy=mix(cy,S.ground-H*(.89-.328*f),around);
        }
        const targetX=ax+local+(dst.x+dst.w*(bu+bv)/2-ax)*si;
        cx=mix(cx,targetX,rearColor);
        cy=mix(cy,dst.y+dst.h*f,rearColor);
        if(tail){
          const top=1-f;
          cx+=H*.14*si*top;cy+=H*.14*si*top;
        }
        if(leg){
          const pawWeight=smooth((sourceY-S.legs[leg].pv[1])/(restFt[1]-S.legs[leg].pv[1]));
          const base=ap(B[leg+'L'].w,...restFt);
          const midFoot=dst.foot;
          cx+=pawWeight*(ft[0]-ax-(base[0]-ax)*co-mix(lateral*H,midFoot[0]-ax,rearColor)*si);
          cy+=pawWeight*(ft[1]-mix(base[1],midFoot[1],rearColor));
          // 髋和肩埋在身体里面，弯到小腿时逐渐回到脚掌的落点。
          // 仅在腿根确定内收量，避免跨过腹线的相邻两排突然拉开成三角尖。
          if(j===0 && bodyBounds.length && si>.45){
            const band=bodyBounds.findIndex(row=>row[0]>=cy);
            if(band>0){
              const a=bodyBounds[band-1],b=bodyBounds[band],u=clamp((cy-a[0])/(b[0]-a[0]||1));
              const left=mix(a[1],b[1],u),right=mix(a[2],b[2],u);
              const padding=H*.012,room=Math.min(width+padding,(right-left)/2);
              const inner=Math.max(left+room,Math.min(right-room,cx));
              rootInset=(inner-cx)*smooth((si-.45)/.30);
            }
          }
          const upper=1-smooth((f-.06)/.56);
          const farShoulder=leg==='ff' ? (ax-cx)*.22*(2*si*co)**2 : 0;
          cx+=(rootInset+farShoulder)*upper;
        }
        const cu=half*co/(width||1),su=cross*si/(width||1);
        for(let i=0;i<=slices;i++,k+=2){
          const side=i/slices;
          const t=2*side-1,norm=Math.sqrt(Math.max(0,1-t*t));
          // 从身后绕过：毛色沿弧面转走，头越过背面时只看见后脑的短毛。
          // 侧脸沿可见轮廓单向卷走。投影回折会把背景透明边第二次采进后脑，形成灰月牙。
          const faceSide=co>=0?t:-t,shift=Math.min(.74,su*.96);
          const roll=head?(faceSide-shift)/(1-shift*faceSide):t*cu-norm*su*.24;
          const raw=mix(lo,hi,clamp(.5+.5*roll));
          let texU=raw,texV=f;
          if(!head){
            const facing=mix(1-side,side,smooth((co+.16)/.32));
            texU=mix(raw,mix(lo,hi,facing),around);
          }
          primary.uv[k]=texU;primary.uv[k+1]=texV;
          cap.uv[k]=mix(bu,bv,side);cap.uv[k+1]=f;
          const reveal=.65*side+.35*f;
          mask[k]=smooth((si-.56-.13*reveal)/.085);
          // 下巴最下面是原画用来搭住脖子的渐透明毛尖，转斜时让它逐渐收进颈毛。
          mask[k+1]=head?(1-mask[k])*smooth(si/.35)*smooth((f-.90)/.095):0;
          const px=cx+width*t,py=cy;
          const x=M[0]*px+M[2]*py+M[4],y=M[1]*px+M[3]*py+M[5];
          v[k]=x;v[k+1]=y;
          x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        }
      }
      R.gl.bindBuffer(R.gl.ARRAY_BUFFER,primary.ub);
      R.gl.bufferData(R.gl.ARRAY_BUFFER,primary.uv,R.gl.DYNAMIC_DRAW);
      R.gl.bindBuffer(R.gl.ARRAY_BUFFER,cap.ub);
      R.gl.bufferData(R.gl.ARRAY_BUFFER,cap.uv,R.gl.DYNAMIC_DRAW);
      const sideTexture = head && S.faceKit && kit ? kit.curvedFace(face) : layer.tex;
      R.drawMatched(primary,cap,sideTexture,dst.tex,0,1,mask);
      parts[id]=[x0,y0,x1,y1];
    }
    // 将两幅原画的脊背、侧腹和腹线贴在同一张连续网格上。白颈处于后脑下方，
    // 后腿之间的透明剪口属于背面素材的搭接区，斜侧面只显示连贯的臀腹。
    function paintTorso(measure){
      const layer=layers.body,side=layer.turnSection,dst=back.body;
      const c=Math.cos(bodyAngle),s=bodySin,rearMix=smooth((s-.41)/.51);
      const oblique=smooth((Math.abs(c)-.08)/.43),yaw=smooth(s/.50);
      const rearRound=smooth((s-.50)/.40);
      const sw=side.w,rw=dst.w,span=Math.hypot(sw*c,rw*s);
      const center=ax+(side.x+sw/2-ax)*c+(dst.x+rw/2-ax)*s;
      const neck=headPoint([1,0,0,1,0,0],S.headW*.45,S.headH*.67,p);
      let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
      for(let i=0;i<=slices;i++){
        const sc=side.columns[c<0?slices-i:i],rc=dst.columns[i],u=rc.u;
        const taper=Math.sqrt(Math.max(0,1-(2*u-1)**2));
        const rearTop=Math.max(rc.top,.39-.055*taper);
        const rearBottom=Math.min(rc.bottom,.78+.095*taper);
        const rt=mix(rc.top,rearTop,oblique),rb=rearBottom;
        const st=sc.top,sb=sc.bottom;
        const xt=side.x+sc.u*sw,sy=ap(S.bones.body.w,xt,side.y+st*side.h)[1];
        const ey=ap(S.bones.body.w,xt,side.y+sb*side.h)[1];
        // 颈背亮毛和后肢剪口只限制取色。外形仍搭进耳后和腿根，否则转动时会脱节。
        const crown=mix(rc.top,Math.max(rc.top,.19-.035*taper),oblique*.55);
        const shoulder=smooth((sc.u-.64)/.22)*oblique;
        const bellyArch=.965+.060*shoulder*taper-.08*Math.exp(-(((u-.54)/.24)**2))-.10*(2*u-1)**8;
        const belly=mix(rc.bottom,bellyArch,.82);
        let y0=mix(sy,dst.y+crown*dst.h,rearMix),y1=mix(ey,dst.y+belly*dst.h,rearMix);
        const frontEdge=smooth((sc.u-.66)/.28);
        const x=center+span*(u-.5)+(2*u-1)*H*.012*frontEdge*yaw*oblique;
        const neckWeight=smooth(1-Math.abs(x-neck[0])/(H*.28))*yaw;
        const intoBack=Math.max(smooth((c-.03)/.40),smooth((s-.87)/.09));
        const rise=.025+.062*smooth((s-.52)/.35)*intoBack;
        y0=mix(y0,Math.min(y0,neck[1]-H*rise),neckWeight);
        const mid=(y0+y1)/2;
        // 胸前盖在远前腿的渐隐上缘之外，臀部的截面则更圆。
        const profile=mix(smooth(taper/mix(.54,.22,frontEdge)),taper,rearRound*.28);
        const rim=(1-profile)*yaw;
        y0=mix(y0,mid,rim);y1=mix(y1,mid,rim);
        // 背面原画在腿根两侧有一段平直轮廓。按整个躯干的高度给截面加弧度，
        // 保留原有颈、髋搭接。腿根也按同一轮廓计算。
        const round=(2*u-1)**3*H*.027*rearRound;
        const flankX=y=>{
          const dy=(y-(S.ground-.43*H))/(H*.275);
          return x+round*Math.max(0,1-dy*dy);
        };
        if(measure){
          // 旧的腿根约束按高度查轮廓。每个纵向条带覆盖的高度内均写入左右边界。
          if(i===0)for(let n=0;n<=rows;n++)bodyBounds.push([S.ground-H*(.93-.73*n/rows),Infinity,-Infinity]);
          for(const band of bodyBounds)if(band[0]>=y0&&band[0]<=y1){
            const bx=flankX(band[0]);
            band[1]=Math.min(band[1],bx);band[2]=Math.max(band[2],bx);
          }
          continue;
        }
        const lip=Math.min(.15,H*.005/Math.max(1,y1-y0));
        // 侧身颈前的白领位于下巴后方。斜后方贴近镜头的是更靠后的肩部毛色。
        const artU=sc.u-Math.max(0,sc.u-.63)*.72*yaw;
        const sample=Math.acos(1-2*artU)*slices/Math.PI,a=Math.floor(sample);
        const col0=side.columns[a],col1=side.columns[Math.min(slices,a+1)];
        const artTop=mix(col0.top,col1.top,sample-a),artBottom=mix(col0.bottom,col1.bottom,sample-a);
        for(let j=0;j<=rows;j++){
          const k=(j*stride+i)*2;
          const f=j===0?0:j===rows?1:mix(lip,1-lip,(j-1)/(rows-2));
          const y=mix(y0,y1,f),bx=flankX(y);
          const px=M[0]*bx+M[2]*y+M[4],py=M[1]*bx+M[3]*y+M[5];
          primary.pos[k]=px;primary.pos[k+1]=py;
          primary.uv[k]=artU;primary.uv[k+1]=mix(artTop,artBottom,f);
          cap.uv[k]=rc.u;cap.uv[k+1]=mix(rt,rb,f);
          mask[k]=rearMix;
          mask[k+1]=i===0||i===slices||j===0||j===rows?yaw:0;
          left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
        }
      }
      if(measure){for(let j=bodyBounds.length-1;j>=0;j--)if(bodyBounds[j][1]>bodyBounds[j][2])bodyBounds.splice(j,1);return;}
      R.gl.bindBuffer(R.gl.ARRAY_BUFFER,primary.ub);R.gl.bufferData(R.gl.ARRAY_BUFFER,primary.uv,R.gl.DYNAMIC_DRAW);
      R.gl.bindBuffer(R.gl.ARRAY_BUFFER,cap.ub);R.gl.bufferData(R.gl.ARRAY_BUFFER,cap.uv,R.gl.DYNAMIC_DRAW);
      R.drawMatched(primary,cap,layer.tex,dst.tex,0,1,mask);
      parts.body=[left,top,right,bottom];
    }
    // 让白尾尖绕臀部画弧。沿尾巴中线保留原图截面和毛尖；从背面看时尾尖向下垂。
    function paintTail(alpha=1){
      if(!(alpha>0))return;
      const profile=layers.tail.turnSection.tail;
      if(!profile)return;
      const {rest,idx}=profile,n=rest.length/10-1,rearTail=back.tail,w=smooth((bodySin-.30)/.64);
      if(!tailSideMesh){
        tailSideMesh=R.bufs({uv:profile.uv.slice(),pos:new Float32Array(rest.length),idx});
        tailRearMesh=R.bufs({uv:new Float32Array(rest.length),pos:new Float32Array(rest.length),idx});
      }
      const mesh=tailSideMesh,co=Math.cos(bodyAngle),si=bodySin,d=si*si;
      function endPoint(j,bone){
        const a=j*10,f=j/n,x=(rest[a]+rest[a+8])/2,y=(rest[a+1]+rest[a+9])/2;
        const pt=ap(bone.w,x,y);
        const dx=pt[0]-ax;
        const tx=ax+dx*co+H*si*.062*f,hang=S.ground-H*(.55-.264*f);
        const row=Math.round(f*rows),lo=rearTail.rows[row*2],hi=rearTail.rows[row*2+1];
        const mid=rearTail.x+rearTail.w*(lo+hi)*.5;
        return [mix(tx,ax+dx*co+(mid-ax)*si,w),mix(mix(pt[1],hang,d),rearTail.y+rearTail.h*f,w),mid];
      }
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      const start=endPoint(0,S.bones.tail0),end=endPoint(n,S.bones.tail2);
      const vx=end[0]-start[0],vy=end[1]-start[1],length=Math.hypot(vx,vy)||1;
      const ux=vx/length,uy=vy/length,ax0=(rest[0]+rest[8])/2,ay0=(rest[1]+rest[9])/2;
      const last=n*10,ax1=(rest[last]+rest[last+8])/2,ay1=(rest[last+1]+rest[last+9])/2;
      const refLen=Math.hypot(ax1-ax0,ay1-ay0)||1,hand=co<0?-1:1;
      const nx0=rest[8]-rest[0],ny0=rest[9]-rest[1],normalLen=Math.hypot(nx0,ny0)||1;
      const sideX=nx0/normalLen,sideY=ny0/normalLen;
      const along=(sideX*(ax1-ax0)+sideY*(ay1-ay0))/refLen*hand*(1-w),across=Math.sqrt(1-along*along);
      const nx=ux*along+uy*across,ny=uy*along-ux*across;
      const tuck=H*.052*smooth(si/.25)*(1-smooth((si-.55)/.25));
      for(let j=0,k=0;j<=n;j++){
        const f=j/n,a=j*10,originX=(rest[a]+rest[a+8])/2,originY=(rest[a+1]+rest[a+9])/2;
        const row=Math.round(f*rows),lo=rearTail.rows[row*2],hi=rearTail.rows[row*2+1];
        const mid=rearTail.x+rearTail.w*(lo+hi)*.5;
        const width=mix(Math.hypot(rest[a+8]-rest[a],rest[a+9]-rest[a+1])*.5,(hi-lo)*rearTail.w*.5,w);
        // 沿着白尖本来的弧线改变截面中心。截面共用法向，即使尾尖扭转也不会互相折回。
        const curl=(originX-mix(ax0,ax1,f))*sideX+(originY-mix(ay0,ay1,f))*sideY;
        const bend=mix(curl*hand,mid-mix(start[2],end[2],f),w);
        const cx=mix(start[0],end[0],f)+nx*bend,cy=mix(start[1],end[1],f)+ny*bend+tuck*(1-smooth(f/.55));
        for(let i=0;i<5;i++,k+=2){
          const art=a+2*(co<0?4-i:i),r=(i/2-1)*width;
          mesh.uv[k]=profile.uv[art];mesh.uv[k+1]=profile.uv[art+1];
          tailRearMesh.uv[k]=mix(lo,hi,i/4);tailRearMesh.uv[k+1]=f;
          const [x,y]=ap(M,cx+nx*r,cy+ny*r);
          mesh.pos[k]=x;mesh.pos[k+1]=y;
          x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        }
      }
      R.gl.bindBuffer(R.gl.ARRAY_BUFFER,mesh.ub);R.gl.bufferData(R.gl.ARRAY_BUFFER,mesh.uv,R.gl.DYNAMIC_DRAW);
      R.gl.bindBuffer(R.gl.ARRAY_BUFFER,tailRearMesh.ub);
      R.gl.bufferData(R.gl.ARRAY_BUFFER,tailRearMesh.uv,R.gl.DYNAMIC_DRAW);
      R.drawMatched(mesh,tailRearMesh,layers.tail.tex,rearTail.tex,smooth((si-.655)/.07),alpha);parts.tail=[x0,y0,x1,y1];
    }
    // 斜后视角先让大腿根转入肚皮后面；近侧原画在髋和肩处的淡边用于侧面搭接。
    const rear=bodySin>.46;
    const legsAt=(side)=>{paint('hind-leg-'+side);paint('front-leg-'+side);};
    paintTorso(true);
    const tailInFront=bodySin>.70;
    if(!tailInFront)paintTail();
    if(rear){
      paint('front-leg-far');paint('front-leg-near');
      paint('hind-leg-far');paint('hind-leg-near');
    } else legsAt('far');
    paintTorso(false);
    if(!rear)legsAt('near');
    paint('head');paint('ear');
    if(tailInFront)paintTail();
    if(face.carry && kit?.note && kit.noteCfg && S.facePoints?.mouthHold){
      const m=S.facePoints.mouthHold,at=headPoint(M,...m,p),nc=kit.noteCfg,n=kit.note;
      const scale=Math.hypot(M[0],M[1])*nc.width/n.w;
      const hand=Math.sign(M[0]),co=Math.cos(headAngle),depth=smooth((Math.abs(co)-.36)/.24);
      if(depth>0){
        const matrix=mul(Tm(...at),mul(Sm(hand*co*scale,scale),mul(Rm(nc.rotation||0),Tm(-nc.grip[0]+(nc.dx||0)*n.w/nc.width,-nc.grip[1]+(nc.dy||0)*n.w/nc.width))));
        parts.note=root.PetRig.quadLocal(R,matrix,0,0,n.w,n.h,n.tex,depth);
      }
    }
  }
  let tailRearMesh,tailSideMesh;
  return {draw,headPoint,foot:(n,p)=>foot(stand,n,p,back[stand.legs[n].id].foot)};
}
root.PetTurn={contour,prepare,loadRear};
})(typeof self!=='undefined'?self:this);
