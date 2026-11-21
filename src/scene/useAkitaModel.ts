import { useEffect, useState } from "react";
import { Mesh, SkinnedMesh, Texture, type BufferGeometry, type Group, type Material, type Skeleton } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import akitaHighUrl from "../assets/akita-high.glb?url";
import akitaLowUrl from "../assets/akita.glb?url";
import { useGameUI } from "../store/useGameUI";

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const urls = { high: akitaHighUrl, low: akitaLowUrl };
type AkitaModel = Pick<GLTF, "scene" | "animations"> & { url: string };

function disposeModel(scene: Group) {
  const resources = new Set<BufferGeometry | Material | Skeleton | Texture>();
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    resources.add(object.geometry);
    if (object instanceof SkinnedMesh) resources.add(object.skeleton);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof Texture) resources.add(value);
      }
    }
  });

  const bitmaps = new Set<ImageBitmap>();
  for (const resource of resources) {
    if (resource instanceof Texture && typeof ImageBitmap !== "undefined" && resource.image instanceof ImageBitmap) {
      bitmaps.add(resource.image);
    }
    resource.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}

export function useAkitaModel(quality: keyof typeof urls) {
  const [model, setModel] = useState<AkitaModel | null>(null);
  const url = urls[quality];

  useEffect(() => {
    if (model?.url === url) return;
    const request = new AbortController();
    async function load() {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok) throw new Error(`Akita model request failed (${response.status})`);
      const { scene, animations } = await loader.parseAsync(await response.arrayBuffer(), "");
      if (request.signal.aborted) disposeModel(scene);
      else setModel({ scene, animations, url });
    }
    void load().catch((error: unknown) => {
      if (request.signal.aborted) return;
      console.error(error);
      useGameUI.getState().setNotice("团子的模型加载失败，请刷新页面或切换画质。");
    });
    return () => request.abort();
  }, [model, url]);

  useEffect(() => {
    if (!model) return;
    return () => {
      // The previous primitive is detached before cleanup. Strict Mode can replay the effect while it stays mounted.
      if (!model.scene.parent) disposeModel(model.scene);
    };
  }, [model]);

  return model;
}
