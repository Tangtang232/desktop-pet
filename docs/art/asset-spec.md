# 比格素材总清单 v4（交给 GPT 一次性生成）

> **v4 新增（2026-11-25）**：① 幼犬的 4 个**过渡姿势**（第 3.3 节），用来解决换姿势时像“闪现”；② **7 个成长阶段**（第 10 节），从刚领回家的奶狗一直到老年。只想先发新增部分给 GPT 的话，发第 3.3 节和第 10 节，外加第 2 节规格和第 8 节开头那句。

> 这份替代之前的两份美术清单。目录结构、`rig.json` 格式沿用你现在 `assets/beagle/hd-library` 的做法，只补程序需要的字段。
> 角色长相以 `hd-library/generation/character-reference.png` 为准，每次出图都带上这张参考图。

## 0. 一共要什么

| 优先级 | 内容 | 数量 | 现在有没有 |
|---|---|---|---|
| **P0** | 幼犬脸部套件：不带耳朵的头底图 + 7 种眼睛 + 9 种嘴 + 坐标表 | 17 张 + 1 个 json | 没有。现有的头底图把耳朵画在了头上，耳朵没法单独甩，要重画 |
| **P0** | 幼犬四个姿势分层（站、坐、趴、睡，各 8 层） | 32 张 + 4 个 json | 有。但要按第 2 节统一比例尺、去掉边缘杂色、`rig.json` 补字段 |
| **P0（v4 新增）** | 幼犬 3 个过渡姿势分层：半蹲、趴到一半、卷到一半（各 8 层）。转身图已交付但不用（见 3.3） | 32 张 + 4 个 json | **已交付（2026-11-25）**，已接进程序 |
| **P1（v4 扩充）** | 成长阶段：奶狗、小狗、少年、青年、成犬、老年（第 10 节），每个阶段 8 个姿势分层 + 脸部套件 | 每阶段 64 + 17 张 + 9 个 json | 只有少年、成年各一套整张图，没有分层 |
| P1 | 毛色参考图（红白、柠檬白、巧克力三色） | 3 张 | 没有 |
| P1 | 道具（碗、粮、纸条、零食、球、窝、项圈、口哨、盲盒） | 20 张 + 1 个 json | 只有三角巾 |
| P2 | 正面坐姿分层（盯着你、开盲盒探头用），三个年龄 | 每龄 6 层 | 没有 |
| P2 | 眼珠单独一层（眼睛跟着鼠标转），三个年龄 | 每龄 2 张 | 没有 |
| P2 | 场景背景 2 张、应用图标 1 张 | 3 张 | 没有 |

P0 做完，现在桌面上那只换姿势就连贯了；P1 做完能按真实时间一路长大、能开出不同毛色。成长阶段按第 10 节的顺序出，先出奶狗和小狗（离现在的幼犬最近，最先用得上）。

---

## 1. 角色和毛色

### 1.1 经典三色（所有分层图都只画这一种）

| 部位 | 颜色（以参考图为准，下面是大致色值） |
|---|---|
| 背部鞍形斑：肩后到尾根，盖住背和体侧上半 | 炭黑带暖调 `#2F2620` 左右 |
| 头、耳朵、肩、大腿外侧 | 蜂蜜棕 `#D98B3E` 左右，暗部 `#B5692A` |
| 额头白纹，连到口鼻；下巴、胸口、肚子、四肢下半段 | 奶白 `#FFF6EA`，暗部 `#EADBC5` |
| 尾巴：根部到中段 | 炭黑 |
| 尾尖最后三分之一 | 奶白 |
| 鼻子 / 眼睛 | 炭黑 / 深棕 |
| 口鼻两侧小斑点 | 浅棕，可有可无 |

画风：柔和手绘，暖棕色细描边（不要黑线），短绒毛笔触，轻柔明暗。光从左上方来。

### 1.2 盲盒毛色变体

**变体不重画整套图**，由程序把经典三色的分层图按颜色区域换色。这样四种毛色的轮廓、动作完全一致，工作量也只有四分之一。GPT 只需要给每种变体出 **1 张参考图**（幼犬站姿整只），程序照着参考图调颜色。

| 变体 | 稀有度 | 和经典三色的区别 | 参考图文件 |
|---|---|---|---|
| 经典三色 | 常见 | — | 已有 |
| 红白 | 常见 | 没有黑色：鞍形斑换成深一档的红棕，尾巴根部也是红棕 | `coats/red-white.png` |
| 柠檬白 | 少见 | 没有黑色：所有棕色换成很浅的柠檬黄，鞍形斑几乎看不出 | `coats/lemon-white.png` |
| 巧克力三色 | 稀有 | 黑色换成巧克力棕；鼻子换成肝棕色；眼睛浅一点的榛色 | `coats/chocolate.png` |

如果哪种变体程序换色效果不好，再单独为它出整套分层。

---

## 2. 全局技术规格（每一张都要满足）

1. **格式**：PNG，RGBA，sRGB，非预乘 alpha，背景完全透明。
2. **朝向**：所有侧面图朝**右**。朝左由程序镜像。
3. **不画**：地面投影、背景、文字、边框、水印。
4. **边缘干净**：半透明的边缘像素必须是毛色本身的颜色，**不能有黄、红、绿、白色的杂色晕边**。现在的素材这一点不合格，比如近侧前腿边缘约 8% 的半透明像素是高饱和黄红色。
5. **同一年龄、四个姿势用同一比例尺**：头部图层的大小在四个姿势之间误差不超过 3%。程序切换姿势时，头不能突然变大变小。
6. **大小**：站姿整只狗从地面到头顶约 1000 像素。三个年龄都画这么大，长大时的真实大小差异由程序缩放。
7. **重叠**：每个子图层（腿、尾巴、头、耳朵）连接父图层的那一端要**多画一截**，伸进父图层下面；这一截不画描边。
8. **补画**：被遮住的地方要画完整。比如身体图层里，腿根、脖子、尾根被盖住的部分都要有毛色；头底图里，耳朵盖住的脸颊要画完整。
9. **配准**：同一姿势的所有图层放在同一张画布坐标系里，叠起来就是完整的狗（`proof.png` 要能直接证明这一点）。

### 2.1 目录

```
hd-library/
  ages/
    baby/                       奶狗（2 个月，刚领回家）          v4 新增
    puppy/                      幼犬（3~4 个月）                  已有
    young/                      小狗（5~6 个月）                  v4 新增
    juvenile/                   少年（7~9 个月，腿长身子细）
    adolescent/                 青年（10~14 个月）                v4 新增
    adult/                      成犬（1.5~7 岁）
    senior/                     老年（8 岁以上，口鼻发白）        v4 新增
      layered/
        stand/  layers/*.png  rig.json  proof.png
        sit/    ...
        prone/  ...
        sleep/  ...
        crouch/   ...           v4 过渡：半蹲（站 <-> 坐、站 <-> 趴之间）
        lie-down/ ...           v4 过渡：趴到一半（坐 <-> 趴之间）
        curl/     ...           v4 过渡：卷到一半（趴 <-> 睡之间）
        turn/     ...           v4 过渡：转身（朝右 <-> 朝左之间，侧身对着镜头）
        front-sit/ ...          P2
      face/
        head-base.png
        eyes/*.png
        mouths/*.png
        pupil/*.png             P2
        placement.json
        proof.png               把 7 种眼睛、9 种嘴分别贴上去的对照图
  coats/*.png
  props/*.png  props.json
  scenes/*.png
  icons/app.png
```

---

## 3. 身体分层（每个年龄 × 站、坐、趴、睡 + 4 个过渡姿势）

### 3.1 八个图层

图层 id 和现在一样。从后往前的叠放顺序写在 `rig.json` 的 `layers` 数组里。

| id | 内容 | 要求 |
|---|---|---|
| `body` | 躯干和脖子 | 腿根、脖子上段、尾根处补画完整；肚子下沿轮廓干净（程序会让肚子鼓起来） |
| `head` | 头，不含耳朵 | 站、坐、趴三个姿势**直接用脸部套件的 `head-base.png`**（同一张图、同一大小），只是位置和角度不同；睡姿单独画一个闭眼、下巴搁在前爪上的头 |
| `ear` | 近侧耳朵 | 耳根多画一截伸进头下面 |
| `tail` | 尾巴 | 尾根多画一截伸进屁股；整条尾巴画成自然的弧线，不要打结 |
| `front-leg-near` | 近侧前腿，整条 | 上端多画一截伸进胸口下面；肘部、腕部弯折处毛色连续，不要断开 |
| `front-leg-far` | 远侧前腿 | 同上，颜色稍暗一点 |
| `hind-leg-near` | 近侧后腿，整条，含大腿 | 上端多画一截伸进身体；跗关节弯折处毛色连续 |
| `hind-leg-far` | 远侧后腿 | 同上，颜色稍暗一点 |

### 3.2 `rig.json`（在你现有格式上补这些字段）

坐标没有特别说明的，都以**该图层 PNG 的左上角**为原点，单位像素。

```json
{
  "version": 2,
  "age": "puppy",
  "pose": "stand",
  "canvas": { "width": 1536, "height": 1152 },
  "ground": 1068,
  "headScale": 1.0,
  "layers": [
    { "id": "body", "parent": null, "file": "layers/body.png", "x": 275, "y": 340, "width": 875, "height": 456,
      "pivot": { "x": 481, "y": 251 },
      "chest": { "x": 700, "y": 230 }, "hip": { "x": 180, "y": 220 }, "belly": { "x": 430, "y": 420 }, "neckBase": { "x": 760, "y": 120 } },
    { "id": "front-leg-near", "parent": "body", "file": "layers/front-leg-near.png", "x": 910, "y": 499, "width": 204, "height": 569,
      "pivot": { "x": 92, "y": 85 }, "joint": { "x": 95, "y": 330 }, "foot": { "x": 110, "y": 540 } },
    { "id": "tail", "parent": "body", "file": "layers/tail.png", "x": 77, "y": 370, "width": 340, "height": 252,
      "pivot": { "x": 306, "y": 207 }, "chain": [ { "x": 306, "y": 207 }, { "x": 200, "y": 170 }, { "x": 110, "y": 100 }, { "x": 40, "y": 20 } ] },
    { "id": "head", "parent": "body", "file": "../../face/head-base.png", "x": 820, "y": 120, "width": 520, "height": 520, "rotation": 0,
      "pivot": { "x": 160, "y": 420 } },
    { "id": "ear", "parent": "head", "file": "layers/ear.png", "x": 851, "y": 182, "width": 246, "height": 382,
      "pivot": { "x": 165, "y": 46 }, "tip": { "x": 120, "y": 360 } }
  ]
}
```

| 字段 | 在哪个图层 | 意思 |
|---|---|---|
| `ground` | 顶层 | 画布上地面线的 y 坐标（爪子踩的位置） |
| `headScale` | 顶层 | 这个姿势里头底图的缩放倍数，四个姿势应该都接近 1.0 |
| `pivot` | 所有图层 | 旋转中心：腿是肩/髋关节，尾巴是尾根，头是脖子连接处，耳朵是耳根 |
| `joint` | 四条腿 | 前腿的肘/腕弯折点、后腿的跗关节，程序在这里让腿弯曲 |
| `foot` | 四条腿 | 爪子着地的中心点 |
| `chain` | 尾巴 | 从尾根到尾尖沿中线的 4 个点，程序据此让尾巴一节带一节地摆 |
| `tip` | 耳朵 | 耳尖位置 |
| `chest` `hip` `belly` `neckBase` | 身体 | 胸口中心、髋部中心、肚子最低处中心、脖子根部，程序据此装脊柱骨骼、让肚子鼓起来 |
| `rotation` | 头 | 头底图在这个姿势里的旋转角度（度，顺时针为正） |

### 3.3 过渡姿势（v4 新增，幼犬先出）

**为什么要**：现在只有站、坐、趴、睡四张，彼此差别太大。程序在两张之间变形再淡入淡出，中间那一下像“闪现”。真狗坐下、趴下、卷起来都有中间状态；把中间状态画出来，程序就能 站 → 半蹲 → 坐 一步步过去，每一步差别小，动作就连上了。

格式和 3.1、3.2 完全一样：8 个图层、同一比例尺、配 `rig.json`，头用同一张 `head-base.png`（卷到一半、转身除外）。**关键是“正好一半”**：每个过渡姿势要介于它两边的姿势之间，爪子位置要和两边对得上（见“对齐要求”一列）。

| 目录 | 介于 | 样子 | 对齐要求 |
|---|---|---|---|
| `crouch/` 半蹲 | 站 ↔ 坐，站 ↔ 趴 | 前腿还直着；后腿弯下去一半，屁股降到站姿和坐姿中间的高度；背从后往前斜着往上；头和站姿差不多高；尾巴放低 | **前爪**位置和站姿完全一样；后爪在站姿和坐姿后爪的中间 |
| `lie-down/` 趴到一半 | 坐 ↔ 趴 | 屁股还坐着；两只前爪往前滑出去一半，胸口降到坐姿和趴姿中间的高度；头往前探 | **后半身**（屁股、后腿）和坐姿一样；前爪在坐姿和趴姿前爪的中间 |
| `curl/` 卷到一半 | 趴 ↔ 睡 | 侧躺下去一半，身体开始弯成弧形，头往回转、朝尾巴方向低下去；眼睛半闭；尾巴往身前绕 | 身体中心和趴姿一样；头和前爪仍在画面右边 |
| ~~`turn/` 转身~~ **不要了** | 朝右 ↔ 朝左 | 站着，身体斜对镜头大约 45°，头正对镜头；看得到两只眼睛、两只耳朵；四只爪子都着地 | 身体中心、整体高度和站姿一样 |

补充：

- `curl` 的头单独画（半闭眼，不用脸部套件）。
- **转身 `turn` 不要了（2026-11-25）**：试过以后，转身时出现正脸看着很怪，改成程序原地翻面。之后各成长阶段都**不用**出转身图。
- 睡姿 `sleep`：头和前爪放在画面**右边**，和其他姿势同一侧，头往回弯搁在前爪上。现有幼犬睡姿是反的（前爪在左边），程序会自动镜像，不用重画；新阶段按右边画。
- 每个过渡姿势也出一张 `proof.png`。再出一张 `transition-strip.png`：站、半蹲、坐、趴到一半、趴、卷到一半、睡，按同一比例尺、同一条地面线横着排成一排，方便检查每一步是不是都“正好一半”。

---

## 4. 脸部套件（每个年龄一套）

### 4.1 头底图 `face/head-base.png`

- 右侧 90 度正侧面，和站姿分层里的头角度一致。
- **不带耳朵**（耳朵单独一层），耳朵盖住的脸颊画完整。
- **不带眼睛**：眼睛位置画成平整的毛皮，眼睛零件贴上去后要严丝合缝。
- **不带嘴巴线**：口鼻下半部分是干净的白色毛，嘴由嘴巴零件贴上去。
- 鼻子、额头白纹、口鼻上的小斑点都画在底图上。
- 下方脖子切口干净，多画一截伸进身体下面。

### 4.2 眼睛 `face/eyes/*.png`（7 种）

所有眼睛零件**画在同一个矩形里**，贴到底图上位置完全一致；零件要包含眼睛周围一圈毛皮，边缘羽化，贴上去看不出接缝。

| 文件 | 样子 | 程序里用在 |
|---|---|---|
| `open.png` | 正常睁开，深棕虹膜，两个高光 | 平常、好奇 |
| `look-up.png` | 眼珠往上看，眼神"求求你" | 讨吃的、想你理它 |
| `half.png` | 上眼皮垂到一半 | 犯困、满足、闻东西、吃饭 |
| `closed.png` | 闭眼，一条向下弯的线 | 眨眼、睡觉、打哈欠 |
| `happy.png` | 开心眯成向上弯的月牙 | 开心、被摸、蹦跳 |
| `sad.png` | 外眼角下垂、眼睛湿润、眉头内侧上扬 | 委屈、被拎太久 |
| `wide.png` | 睁大，眼白多露一点 | 吃惊、被戳 |

### 4.3 嘴 `face/mouths/*.png`（9 种）

嘴巴零件覆盖口鼻下半部分到下巴，包括嘴唇线、需要时的口腔和舌头。同样要求边缘羽化，贴上去无接缝。

| 文件 | 样子 | 程序里用在 |
|---|---|---|
| `neutral.png` | 闭嘴，自然的嘴角线 | 平常、委屈之外的大多数时候 |
| `smile.png` | 闭嘴微笑，嘴角上扬 | 满足、好奇 |
| `pant.png` | 张嘴吐舌头喘气 | 开心、邀你玩、走路 |
| `yawn.png` | 张大嘴打哈欠，舌头卷起 | 打哈欠、伸懒腰 |
| `frown.png` | 闭嘴，嘴角下撇 | 委屈 |
| `lick.png` | 舌头往上舔过鼻头 | 饿了、吃完 |
| `chew.png` | 微微张开在嚼，腮帮鼓一点 | 吃饭 |
| `surprised.png` | 小小张开成 O 形 | 吃惊 |
| `hold.png` | 嘴唇微张、咬住东西的样子（东西由程序画） | 叼纸条、叼球 |

### 4.4 `face/placement.json`

沿用你现在的格式：以 `head-base.png` 左上角为原点，给出每个眼睛、嘴巴零件在底图上的矩形。再补三个点：

```json
{
  "head": "head-base.png",
  "canvas": { "width": 1254, "height": 1254 },
  "eyes":   { "open": { "file": "eyes/open.png", "x": 718, "y": 389, "width": 158, "height": 109 } },
  "mouths": { "neutral": { "file": "mouths/neutral.png", "x": 811, "y": 726, "width": 343, "height": 47 } },
  "points": {
    "nose": { "x": 1150, "y": 560 },
    "mouthHold": { "x": 1060, "y": 760 },
    "eyeCenter": { "x": 797, "y": 443 }
  }
}
```

`mouthHold` 是叼东西时东西的中心点，`eyeCenter` 是眼睛中心。程序用它们画叼着的纸条、算眼睛看向哪里。

---

## 5. P2 可选

| 内容 | 要求 |
|---|---|
| 正面坐姿 `front-sit` | 正对画面坐着，6 层：身体、头（含两只耳朵根）、左耳、右耳、尾巴、前腿（两条画在一起），带 `rig.json`。用在盯着你看、开盲盒探头、迎接上线的人 |
| 眼珠分层 `face/pupil/` | `socket.png`：眼白和眼眶，不含瞳孔；`pupil.png`：瞳孔加高光，单独一层。程序移动瞳孔让眼睛跟着鼠标转 |

---

## 6. 道具 `props/`

和幼犬同一比例尺：碗的宽度大约是幼犬站姿身体长度的 0.45 倍。都要透明背景、边缘干净、光从左上方来。

| 文件 | 内容 | 说明 |
|---|---|---|
| `bowl-back.png` / `bowl-front.png` | 浅蓝陶瓷狗碗的后半（含碗口内侧）和前壁 | 两张配准在同一画布；狗低头吃饭时嘴伸进两层之间 |
| `kibble-1.png` ~ `kibble-3.png` | 三种形状的单颗狗粮 | 程序一粒粒堆进碗里 |
| `food-bag.png` | 狗粮袋 | 以后拖到碗上倒粮 |
| `note-folded.png` | 对折的小纸条，角上一颗小红心 | 叼在嘴里、放在地上 |
| `note-open.png` | 展开的纸条，纸面留空 | 展开后的背景，文字由程序写 |
| `biscuit.png` | 骨头形饼干 | 远程投喂 |
| `ball.png` | 网球 | 甩出去它去追 |
| `rope.png` | 两头打结的绳结玩具 | |
| `bed-back.png` / `bed-front.png` | 圆形软垫窝的后沿和前沿 | 两张配准；趴进去时前沿挡住身体下半 |
| `whistle.png` | 小号银色口哨 | 呼唤它的入口 |
| `collar-back.png` / `collar-front.png` / `tag.png` | 红色项圈后半、前半，空白圆名牌 | 名字由程序写在名牌上 |
| `box-body.png` / `box-lid.png` / `box-ribbon.png` | 盲盒：圆角纸盒身、盒盖、布绑带 | 三张配准；不要商标和文字 |

`props.json`：每个文件的宽高，配准图给出在共同画布上的位置，再给出锚点（碗口中心、窝的中心、纸条中心）。

---

## 7. 场景和图标（P2）

| 文件 | 内容 |
|---|---|
| `scenes/blindbox.png` | 1600×900，开盲盒用：简单暖色背景，中间留出放盒子的空位，不要文字 |
| `scenes/home.png` | 1200×800，没人在线时的家：墙角、地板、一小块毯子，暖色，给远程小窗当背景 |
| `icons/app.png` | 1024×1024，幼犬头像，透明背景，应用图标和托盘图标都从它缩 |

---

## 8. 给 GPT 的提示词模板

每条都附上 `character-reference.png`，并以这一句开头：

```
Use the attached character reference. Keep exactly the same beagle: same proportions, markings, colors, eye color, line color and painting style. Production asset for a 2D cutout puppet in a desktop pet app. Transparent RGBA background, no shadow, no ground, no text. Clean anti-aliased edges whose semi-transparent pixels are the fur color only, with no yellow, red, green or white fringe. Light from the upper left. Facing right.
```

**身体分层**（每个年龄、每个姿势一次）：

```
[开头那句] Age: {see section 10}. Pose: {standing | sitting | lying sphinx-style with front legs forward | curled up asleep, head and front paws on the RIGHT side, head turned back resting on the front paws}. Deliver 8 separately painted, registered layers on one shared canvas: body (torso and neck, fully painted where legs, head and tail attach), head WITHOUT the ear (for stand, sit and prone use the provided head-base exactly; for sleep paint a resting head with closed eyes), near ear, tail, near front leg, far front leg, near hind leg, far hind leg. Each child layer extends under its parent with an extra overlap and no outline on the overlap. Far legs slightly darker. Same scale as the other poses of this age: the head must be the same size. Also provide rig.json with canvas, ground line, and per layer: position, pivot, and the extra points described in the spec (joint and foot for legs, 4-point chain for the tail, tip for the ear, chest, hip, belly and neckBase for the body).
```

**过渡姿势**（v4，每个年龄 4 次）：

```
[开头那句] Age: {see section 10}. This is an IN-BETWEEN pose for smooth animation, exactly halfway between two existing poses of this same dog (both attached). Pose: {crouch: halfway from standing to sitting, front legs still straight with the front paws in exactly the same place as in the standing pose, hind legs half bent, rump lowered halfway, back sloping up toward the shoulders, tail low | lie-down: halfway from sitting to lying, rump and hind legs exactly as in the sitting pose, front paws sliding forward halfway, chest lowered halfway, head reaching forward | curl: halfway from lying sphinx-style to curled up asleep, body starting to bend into an arc, head turning back toward the tail and lowering, eyes half closed, head and front paws still on the right side | turn: standing, body angled about 45 degrees toward the viewer, head facing the viewer with both eyes and both ears visible, all four paws on the ground}. Same scale, same ground line and same body center as the neighbouring poses. Deliver the same 8 registered layers and rig.json as the main poses (for curl and turn paint the head as its own layer; for turn put both ears in the head layer). Also deliver transition-strip.png: stand, crouch, sit, lie-down, prone, curl, sleep side by side on one ground line at the same scale.
```

**头底图**：

```
[开头那句] Age: {...}. Paint ONLY the head in a strict 90-degree right-facing profile, matching the head in the standing pose. NO ear (the ear is a separate layer; paint the cheek fully where the ear would cover it). NO eyes: paint smooth fur where the eye goes. NO mouth line: keep the lower muzzle clean white fur. Keep the nose, white blaze and muzzle freckles. Clean neck cut with extra length for overlap.
```

**眼睛 / 嘴**：

```
[开头那句] Paint {the 7 eye states | the 9 mouth states} listed below as separate overlay patches for the provided head-base, each in the same rectangle so they register exactly. Include a small feathered margin of surrounding fur so they blend seamlessly. Eye states: open, look-up pleading, half-lidded, closed downward curve, happy upward crescent, sad with drooping outer corners and watery eyes, wide surprised. Mouth states: neutral closed, closed smile, panting with tongue out, wide yawn with curled tongue, frown, tongue licking the nose, chewing, small surprised O, lips gripping a small object. Also provide placement.json with each rectangle and the nose, mouthHold and eyeCenter points.
```

**毛色参考**：

```
[开头那句] Same puppy in the standing pose, but coat variant: {red and white: no black, the saddle is a deeper red-tan | lemon and white: no black, all tan areas very pale lemon | chocolate tricolor: black replaced by chocolate brown, liver-brown nose, lighter hazel eyes}. Identical pose, outline and markings layout as the reference.
```

**道具**：

```
Same art style as the attached beagle reference: soft hand-painted, thin warm brown outlines, light from the upper left, transparent background, clean edges, no text, no logos. Paint: {道具名和要求，见第 6 节}. Registered pairs (bowl back/front, bed back/front, collar back/front, box body/lid/ribbon) must share one canvas.
```

---

## 9. 验收

- [ ] 每个年龄的四个姿势，`head` 图层大小一致（误差 3% 内）
- [ ] 所有图层叠起来和 `proof.png` 一致，没有缝
- [ ] 放大看边缘，没有黄、红、绿、白色晕边
- [ ] 头底图上没有耳朵、没有眼睛、没有嘴巴线
- [ ] 7 种眼睛、9 种嘴分别贴到底图上，看不出接缝（`face/proof.png`）
- [ ] `rig.json` 里每条腿都有 `joint` 和 `foot`，尾巴有 4 个点的 `chain`，身体有 `chest` `hip` `belly` `neckBase`
- [ ] 毛色参考图和经典三色的轮廓、姿势完全一致，只有颜色不同
- [ ] 道具的配准对（碗、窝、项圈、盲盒）叠起来是完整的一件
- [ ] `transition-strip.png` 里每个过渡姿势都正好介于两边之间：半蹲的前爪和站姿重合，趴到一半的屁股和坐姿重合
- [ ] 相邻两个成长阶段并排（`growth-strip.png`），看得出是同一只狗在长大：斑纹位置、额头白纹形状、尾尖白色都对得上
- [ ] 每个阶段的头底图、眼睛、嘴和这个阶段的身体比例匹配（奶狗头大眼睛大，老年口鼻发白）

---

## 10. 成长阶段（v4 新增）

宠物按**真实时间**长大（PRD 里定的，不是喂几顿就突然变大）。领养时是 2 个月的奶狗，一年半左右长成成犬。程序会在相邻两个阶段之间慢慢调比例（腿一点点变长、头一点点显小），到了阶段交界、趁它睡觉时换成下一阶段的素材。所以**每个阶段只画“这个阶段最典型的样子”**，中间的渐变交给程序。

每个阶段要的东西和幼犬一样：

- 7 个姿势分层：站、坐、趴、睡 + 半蹲、趴到一半、卷到一半（第 3 节；转身图不用出）
- 脸部套件：头底图 + 7 种眼睛 + 9 种嘴 + `placement.json`（第 4 节）
- 一张 `growth-strip.png`：这个阶段和前一个阶段的站姿并排，按下表的**相对身高**画，检查是不是同一只狗

分层图仍然按“站姿约 1000 像素高”画（第 2 节第 6 条），屏幕上的真实大小由程序按相对身高缩放。

| 顺序 | 目录 | 名字 | 真实年龄 | 相对身高（成犬=1） | 头高占身高 | 体型要点 | 现状 |
|---|---|---|---|---|---|---|---|
| 1 | `baby/` | 奶狗 | 2 个月 | 0.45 | 约 50% | 圆滚滚，腿短而粗，爪子显得特别大；头很大、额头鼓、眼睛又大又圆、口鼻很短；耳朵相对头长得夸张；尾巴短细；肚子圆、略下垂；毛蓬松带绒 | 新增，**先出** |
| 2 | `puppy/` | 幼犬 | 3~4 个月 | 0.6 | 约 45% | 现在这只 | 已有（还差过渡姿势） |
| 3 | `young/` | 小狗 | 5~6 个月 | 0.75 | 约 40% | 腿开始变长，身体拉长，肚子没那么圆；口鼻长一点；耳朵还偏大；仍然奶气、毛软 | 新增，**先出** |
| 4 | `juvenile/` | 少年 | 7~9 个月 | 0.88 | 约 36% | 腿细长、关节显大，腰细胸窄，有点“长手长脚”的不协调；口鼻更长；头仍略大 | 有整张图，要按新格式分层 |
| 5 | `adolescent/` | 青年 | 10~14 个月 | 0.96 | 约 33% | 比例接近成犬但更瘦、更精神，胸开始变深，肌肉线条出来；眼神机灵 | 新增 |
| 6 | `adult/` | 成犬 | 1.5~7 岁 | 1.0 | 约 31% | 结实，胸深，背平直，腿和身体匀称，口鼻方正；毛短而亮 | 有整张图，要按新格式分层 |
| 7 | `senior/` | 老年 | 8 岁以上 | 0.98 | 约 31% | 骨架同成犬，但口鼻、眉毛、下巴一圈发白；背略塌，肚子略松；眼神温和、眼皮略垂 | 新增，最后出 |

个体的**先天差异**（腿稍长、个子稍小、耳朵稍长）由程序在骨骼上微调，**不用**另外出图。

**给 GPT 的年龄描述**（填进第 8 节模板的 `Age:` 后面）：

```
baby:       8-week-old beagle puppy just adopted: very round chubby body, short stubby legs with oversized paws, very large domed head with big round eyes and a very short muzzle, ears exaggeratedly long for the head, short thin tail, round slightly sagging belly, fluffy soft puppy fur.
puppy:      3-4 month old beagle puppy (the attached reference character as it is now).
young:      5-6 month old beagle: legs starting to lengthen, body longer and less round, muzzle a little longer, ears still large, still soft and puppyish.
juvenile:   8 month old adolescent beagle: noticeably longer slim lanky legs, narrow waist and chest, lighter bone, slightly longer muzzle, still slightly oversized head, paws a touch too big.
adolescent: 12 month old young beagle: nearly adult proportions but leaner and more energetic, chest starting to deepen, visible muscle tone, bright alert eyes.
adult:      3 year old adult beagle: sturdy, deep chest, level back, balanced legs and body, square muzzle, short glossy coat.
senior:     10 year old senior beagle: same frame as the adult but with a greying white muzzle, eyebrows and chin, back dipping slightly, belly a little soft, gentle slightly droopy eyes.
```

出图顺序：幼犬的 4 个过渡姿势 → 奶狗 → 小狗 → 少年 → 青年 → 成犬 → 老年。每个阶段做完先给我接进程序看效果，有问题当场改提示词，别一口气出完再返工。
