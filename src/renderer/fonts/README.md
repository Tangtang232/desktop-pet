# 字体

`pet-hand.woff2`：纸条用的手写体。由霞鹜文楷（LXGW WenKai）v1.530 Regular 裁剪而来，只保留 GB2312 的全部字符、ASCII 和常用标点（7550 个字形），转成 WOFF2。

按 SIL Open Font License 1.1 发布，许可证见同目录的 `OFL.txt`。原字体声明了保留字体名（"霞鹜"、"LXGW" 等），所以裁剪后的版本改名为 **PetHand**，不使用保留字体名。

- 原字体：https://github.com/lxgw/LxgwWenKai
- 重新生成：`tools/subset_font.py <原 ttf> src/renderer/fonts/pet-hand.woff2`（需要 `pip install fonttools brotli`）
