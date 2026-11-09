"""Pseudo-3D reconstruction from a handful of chroma-keyed views of one object.

Pipeline: chroma keying (keying) -> camera model (camera) -> silhouette fields and visual hull (hull)
-> camera pose refinement (align) -> surface extraction (mesh) -> web assets (export).
"""
