> 已被 [asset-spec.md](asset-spec.md) 取代，留作记录。

# 比格桌面宠物 · 2D 美术需求清单 v2

> 这一版替代之前的 3D 清单。路线：AI 出整图 → 拆成零件 → 在 Godot 里装 2D 骨骼和网格 → 程序驱动动作和表情。

## 0. 先做什么

第一步只做一个**小验证**，别一上来铺满：

1. 用你现在这张侧面站姿（就是 GPT 给的那张），按第 3 节拆成零件。
2. 再补 3 个眼睛零件（睁开、半闭、闭眼）和 2 个嘴巴零件（闭着、张嘴吐舌头）。
3. 发给我，我在 Godot 里装骨骼，让它走两步、摇尾巴、眨眼、甩耳朵、呼吸、肚子鼓起来。

动起来好看再按这份清单往下做；不好看，我们看问题出在拆法还是画法上。

**交付格式，按方便程度排**：
- 最好：一个分层文件（PSD 或 Krita 的 `.kra`），每个零件一层，位置就是在整图里的原位置。
- 其次：每个零件一张透明底 PNG，**画布尺寸和整图一样大**，零件留在原位置不动。
- 最差：零件散放在一张图上。这种我得手动对位，误差会大，尽量别用。

---

## 1. 角色设定（按你选的那张图统一）

**画风**（照你那张图）：柔和的手绘数字插画，暖棕色细线描边（不是黑线），轻柔的明暗过渡，奶白色的白毛，眼睛大、有光泽，可爱但比例像真狗。

**光照**：光从左上方来，不画地面投影（投影由程序加）。

**毛色**（经典三色）：
- 背部黑色鞍形斑：肩后到尾根，盖住背和体侧上半。
- 棕褐色：头、耳朵、肩膀、大腿外侧。
- 白色：额头中线白纹，和口鼻连成一片；下巴、胸口、肚子、四肢下半段。
- 尾巴：靠身体那半截是黑色，**后三分之一是白色**。你那张图侧面和背面的尾巴不一致，以这条为准。
- 鼻子黑色，眼睛深棕色。

**去掉**：坐姿图上的绿围巾。设定图里不戴任何饰品，饰品以后单独画成零件。

**成长分三个阶段画**，三套零件的拆法、层级、命名完全一样，同一套骨骼和动作能共用：

| 阶段 | 月龄 | 特征 |
|---|---|---|
| 幼犬 | 2–4 个月 | 头大、眼睛偏低、口鼻短、爪子显大、肚子圆、腿短；头顶和耳朵颜色偏深。你现在这张就算这个阶段 |
| 青春期 | 5–8 个月 | 腿先长长，身子还没跟上，略显瘦长；口鼻变长 |
| 成年 | 9 个月以后 | 比例协调，胸更深，口鼻成年长度 |

同一阶段内部，每天的细微成长由程序调骨骼比例。换阶段的那一下，安排在它去别人家串门或者睡着的时候。

---

## 2. 姿势套

2D 只能看固定角度，所以每个基础姿势单独画一套、单独拆。**所有侧面图都朝右**，朝左时程序直接镜像。

| 套 | 姿势 | 从这套骨骼摆出来的动作 | 优先级 |
|---|---|---|---|
| S1 | 侧面站立 | 走、跑、闻地面、邀玩、抬爪、低头吃饭、蹦、被拎起悬空、转身 | P0 |
| S2 | 侧面坐 | 饿了等饭、困了打瞌睡、看着碗 | P1 |
| S3 | 侧面趴（下巴能搁在前爪上） | 无聊、吃撑了、被摸 | P1 |
| S4 | 蜷成一团睡 | 睡着、做梦 | P1 |
| S5 | 正面坐 | 盯着你看、开盲盒探头、有人上线时迎接 | P2 |

套和套之间的切换（站→坐、坐→趴、趴→睡），靠程序做一段短过渡，不用单独画过渡帧。

---

## 3. 零件拆分（以 S1 侧面站为例，其他套照这个思路）

### 3.1 零件表（从最底层往上排）

| 层 | 零件名 | 内容 | 要补画的地方 |
|---|---|---|---|
| 1 | `leg_hind_far_upper` / `_lower` / `_paw` | 远侧后腿，分大腿、小腿、爪三段 | 每段上端多画一截，伸进上一段下面 |
| 2 | `leg_front_far_upper` / `_lower` / `_paw` | 远侧前腿，三段 | 同上 |
| 3 | `ear_far` | 远侧耳朵露出来的那一点 | 补成完整耳朵形状 |
| 4 | `tail` | 整条尾巴，画成伸直、略向上翘 | 尾根多画一截伸进身体里 |
| 5 | `body` | 躯干加脖子，肚子包括在内 | 腿和头盖住的地方全部补完整：肩、大腿根、脖子上段 |
| 6 | `leg_hind_near_upper` / `_lower` / `_paw` | 近侧后腿，三段；大腿那段带着大腿的肌肉轮廓 | 每段上端多画一截 |
| 7 | `leg_front_near_upper` / `_lower` / `_paw` | 近侧前腿，三段 | 每段上端多画一截 |
| 8 | `mouth_inside` | 口腔内部（深色）加下排牙 | 整块画出来，平时被下巴盖住 |
| 9 | `tongue` | 舌头，伸出来的长度 | 根部多画一截藏进嘴里 |
| 10 | `jaw` | 下巴（下颌），能往下张开 | 上端多画一截藏在头下面 |
| 11 | `head` | 头骨加上嘴、口鼻，不含耳朵、眼睛、眉毛、鼻子 | 近侧耳朵盖住的脸颊补完整；眼睛位置补成皮毛底色（眼睛零件另外贴上去） |
| 12 | `nose` | 鼻头 | 无 |
| 13 | `eye` | 近侧眼睛（见第 4 节的表情零件） | 无 |
| 14 | `brow` | 眉毛那一小块深色毛 | 无 |
| 15 | `ear_near` | 近侧耳朵，最上层 | 无 |

### 3.2 拆分规则

- **关节重叠**：每段腿、尾根、脖子的上端都要多画出一截，被上一层盖住。这样转动时关节处不会露缝。
- **重叠处不要描边**：零件伸进别的零件下面的那段不要画描边线，不然一转就会看到一条线穿出来。描边只留在外轮廓上。
- **补画**：被盖住的地方要画完整，尤其是：近侧耳朵下面的脸颊、腿根处的身体、尾根处的屁股、下巴下面的口腔。
- **关节位置我来定**，你不用标。
- **分辨率**：整只狗在图里高约 1000 像素。桌面上只显示 150 到 250 像素，原图大一点，缩小后更清楚。三个成长阶段用同一个比例尺。
- **命名**：照抄上面的零件名，三个阶段用后缀区分：`_pup`（幼犬）、`_teen`（青春期）、`_adult`（成年）。

---

## 4. 表情零件

表情靠换零件实现。S1 侧面需要下面这些，S5 正面另需一套正脸版。

| 零件 | 版本 | 用在 |
|---|---|---|
| 眼睛 `eye_` | `open` 睁开 | 默认 |
| | `half` 半闭 | 犯困、闻东西、吃饭 |
| | `closed` 闭眼（向下弯的线） | 眨眼、睡着、打哈欠 |
| | `happy` 开心眯成月牙 | 被摸、蹦跳、吃饱 |
| | `sad` 委屈（眼睛大、湿润、外眼角下垂） | 委屈、饿了 |
| | `wide` 睁大 | 好奇、吃惊、兴奋 |
| 眼珠 `pupil` | 单独一层，只有瞳孔和高光 | 程序移动它，表现看哪里 |
| 眉 `brow_` | `flat` 平 / `worried` 内侧上扬 / `up` 上扬 | 委屈、饿了用 `worried`；好奇用 `up` |
| 嘴 `mouth_` | `closed` 闭着微笑 | 默认 |
| | `pant` 张嘴吐舌喘气 | 开心、想玩（配合 `jaw` 张开） |
| | `frown` 嘴角下撇 | 委屈 |
| | `yawn` 张大打哈欠 | 犯困 |
| | `lick` 舌头舔过鼻头 | 饿了、吃完 |
| 鼻子 `nose_` | `normal` / `sniff`（鼻头皱起） | 闻东西 |
| 耳朵 `ear_near_` | `normal` / `back`（往后贴，比正常窄一点） | 委屈、害怕 |

眨眼、看哪里、张嘴的大小、耳朵尾巴的甩动、呼吸、肚子鼓起来，都由程序实时控制，不用画成动画帧。

---

## 5. 动作清单

动作全部由程序在骨骼上做，美术只负责零件。这张表告诉你每个动作用哪套姿势，方便你判断要先画哪套。

| 动作 | 姿势套 | 优先级 |
|---|---|---|
| 站立待机、呼吸、摇尾巴、眨眼、甩耳朵 | S1 | P0 |
| 走、小跑、转身（镜像） | S1 | P0 |
| 低头吃饭、舔嘴 | S1 | P0 |
| 被鼠标拎起悬空、落地 | S1 | P0 |
| 低头闻地面走 | S1 | P1 |
| 邀玩（前身趴低屁股撅高）、蹦一下、抬一只前爪、歪头 | S1 | P1 |
| 叼纸条走路（带话） | S1，加纸条道具 | P1 |
| 坐着等、扒拉碗、打瞌睡点头、打哈欠 | S2 | P1 |
| 趴着、下巴搁爪子、叹气、被摸时眯眼 | S3 | P1 |
| 蜷着睡、做梦蹬腿、睡醒伸懒腰 | S4 | P1 |
| 正面盯着你、开盲盒探头、迎接上线的人 | S5 | P2 |

---

## 6. 道具

道具也要按"会和狗发生遮挡"来拆层。

| 道具 | 拆成几层 | 说明 | 优先级 |
|---|---|---|---|
| 食盆 | 2 层：碗的后半（含碗口内侧） + 碗的前壁 | 狗低头吃饭时，嘴伸进两层之间 | P0 |
| 狗粮颗粒 | 单颗，画 3 种形状 | 碗里的粮一粒粒变少 | P0 |
| 盲盒 | 3 层：盒身、盒盖、绑带 | 盖子能掀开，绑带能松开 | P0 |
| 纸条 | 折起（叼在嘴里）、展开，两张 | 带话 | P1 |
| 零食 | 骨头形饼干 | 远程投喂 | P1 |
| 狗窝 | 2 层：后沿 + 前沿 | 趴进去时前沿挡住身体下半 | P1 |
| 项圈和名牌 | 2 层：项圈后半、项圈前半加名牌 | 名牌留空白，名字由程序写 | P1 |
| 口哨 | 1 层 | 呼唤的入口 | P1 |
| 网球 | 1 层 | 甩出去它去追 | P1 |
| 绳结玩具 | 1 层 | 玩耍 | P2 |

---

## 7. 场景

宠物活在真实桌面上：任务栏顶边当地面，窗口顶边当台子，不需要背景。需要画的只有：

| 场景 | 内容 | 优先级 |
|---|---|---|
| 开盲盒 | 一块简单的暖色背景，中间留出放盲盒的位置；加几片会飘落的小纸屑（单独的零件） | P0 |
| 狗窝角落 | 没人在线时它待的家：一面墙角、地板、一小块毯子，暖色，给"远程小窗"当背景 | P1 |

---

## 8. 给 GPT 的提示词

每次都把**你现在那张图**作为参考图一起发，并带上这句：

```
Keep exactly the same character, art style, line color and markings as the reference image.
```

### 8.1 画风和角色描述（每条都带上）

```
A cute beagle for a 2D desktop pet, in the same style as the reference: soft hand-painted digital illustration, thin warm brown line art (not black), gentle soft shading, cream-white fur, big glossy dark brown eyes, realistic dog proportions with a cute face. Classic tricolor: black saddle from behind the shoulders to the base of the tail; tan head, ears, shoulders and outer thighs; white blaze from between the eyes down to a white muzzle; white chin, chest, belly and lower legs. The tail is black near the body and white on the last third. Black nose. No accessories, no collar, no bandana. Light comes from the upper left; no ground shadow.
```

### 8.2 S1 拆分零件（先做这个）

```
[8.1 描述] Using the side view of the reference (facing right, standing), create a cutout parts sheet for 2D skeletal animation. Separate parts, each fully drawn and laid out with space between them on a transparent background: body with neck (fully painted where legs and head would cover it); head without ears, eyes, eyebrows and nose, with the cheek fully painted where the ear would cover it and plain fur where the eye goes; lower jaw; mouth interior with lower teeth; tongue; nose; near ear; far ear; tail drawn straight and slightly raised; each of the four legs split into upper leg, lower leg and paw, with extra length drawn at the top of each segment so it can tuck under the part above. No outline on the parts that tuck under other parts. Same scale as the reference.
```

### 8.3 S1 表情零件

```
[8.1 描述] Side view eye and mouth parts for the same beagle facing right, on a transparent background, same scale as the reference: eyes open, half closed, closed (a soft downward curved line), happy crescent, sad (big, watery, outer corner drooping), wide open; a separate pupil with highlight; eyebrow patch flat, worried (inner end raised), raised; mouth closed smiling, panting with tongue out, frowning, wide yawn, tongue licking the nose; nose normal and wrinkled while sniffing; near ear normal and pulled back.
```

### 8.4 S2 到 S5 整图（验证通过后再做）

```
[8.1 描述] Full body of the same beagle, facing right, side view, sitting upright with all four legs visible. Transparent background, same scale as the reference.
```

```
[8.1 描述] Full body of the same beagle, facing right, side view, lying down sphinx-style with front legs stretched forward and chin raised. Transparent background, same scale as the reference.
```

```
[8.1 描述] Full body of the same beagle curled up asleep, seen from the side and slightly above, tail wrapped around the body, eyes closed. Transparent background, same scale as the reference.
```

```
[8.1 描述] Full body of the same beagle sitting and facing the viewer, looking straight at the viewer. Transparent background, same scale as the reference.
```

### 8.5 成长阶段（验证通过后再做）

```
[8.1 描述] The same beagle as a lanky 6-month-old: legs longer, body slightly thin, muzzle a bit longer, head relatively smaller than the puppy. Side view facing right, standing, same pose and scale as the reference.
```

```
[8.1 描述] The same beagle as a 12-month-old adult: balanced proportions, deeper chest, full-length muzzle. Side view facing right, standing, same pose and scale as the reference.
```

### 8.6 道具

```
Props for the same cute beagle desktop pet, same soft hand-painted style with thin warm brown line art, transparent background, no text, no logos: a pale-blue ceramic dog bowl split into two layers (back half with the inside rim, and front wall); three kibble pieces of different shapes; a cardboard gift box with air holes split into box body, lid and fabric ribbon; a folded paper note and the same note unfolded; a bone-shaped biscuit; a round plush dog bed split into back rim and front rim; a red collar with a blank round name tag; a small silver whistle; a tennis ball; a rope toy.
```

**GPT 出零件的已知问题**：零件之间的比例和位置不一定对得上，被盖住的部分有时会画缺。拿到之后先在 Photoshop 或 Krita 里把零件摆回整图的原位置，对一下，缺的地方补上，再发给我。

---

## 9. 验收清单

**整图**
- [ ] 朝右；四条腿都能看清
- [ ] 尾巴后三分之一白，其余黑
- [ ] 没有围巾、项圈这类饰品
- [ ] 三个成长阶段站在一起，看得出是同一只狗

**零件**
- [ ] 零件名和第 3、4 节一致
- [ ] 每段腿、尾根、脖子的上端都多画了一截
- [ ] 伸进别的零件下面的那截没有描边
- [ ] 耳朵下面的脸颊、腿根处的身体、下巴下面的口腔都补完整了
- [ ] 所有零件拼回去，和整图对得上，没有缝
- [ ] 表情零件缩小到 150 像素宽，还能分清是哪种表情
