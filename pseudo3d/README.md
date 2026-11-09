# 伪 3D 重建（pseudo3d）

从同一物体的多张不同角度图片（绿幕背景）重建一个可实时旋转查看的伪 3D 模型。

在线查看：<https://rieszprojects.github.io/test-project/pseudo3d/>（源码在 `site/pseudo3d/`）

## 流程

1. `gen/novelai.py`：用 NovelAI 生成参考图（绿幕）。
2. `gen/gpt_views.py`：按 `objects/<名称>/views.json` 里写好的相机描述，用 OpenAI 图像编辑接口生成其他视角。
3. `build.py`：抠绿幕 → 只用轮廓估计每张图的相机 → 鲁棒可视外壳 → 网格 → 导出网页资源。

```bash
uv venv pseudo3d/.venv && uv pip install --python pseudo3d/.venv/bin/python -r pseudo3d/requirements.txt
pseudo3d/.venv/bin/python pseudo3d/build.py pseudo3d/objects/pistol/views.json \
    --raw <原始图片目录> --work <缓存目录> --out site/pseudo3d/assets/pistol
```

## 算法要点

- **相机模型**：正交相机，每张图 7 个参数（方位角、仰角、滚转、缩放、两个平移、横纵比），参考图固定。约定见 `recon/camera.py`。
- **位姿估计**（`recon/align.py`）：两两极线一致性。两台正交相机的轮廓投影到公共轴 `d_i × d_j` 上必须一致，用一维 IoU 打分；参考图的配对权重加倍；角度有弱先验。坐标下降 + 模式搜索。
- **外壳**（`recon/hull.py`、`recon/mesh.py`）：参考图必须满足，其余视角允许 1 张不同意，生成图的轮廓再放宽一点容差；距离场高斯平滑后用 Marching Cubes 提取，Taubin 平滑，简化到约 11 万面。
- **渲染**（`site/pseudo3d/js/`）：WebGL2。每张照片按自己的相机投影到表面，先渲染各视角深度图做遮挡判断，再按非结构化光场（ULR）权重混合角度最近的几张。
