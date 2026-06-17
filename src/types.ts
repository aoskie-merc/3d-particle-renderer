export type TDistributionMethod = "areaWeighted" | "triangleUniform";

/** Controls the wave shape of particle emergence during Beat 3 (Hint) cycles. */
export type THintStyle = "pulse" | "sweep" | "bulge";

/** Controls the spatial shape of the activation region in Beat 3 (Hint) cycles. */
export type THintShape = "blob" | "wedge" | "contour";

/** Controls how strongly the cube morphs toward the figure contours during Beat 3 (Hint). */
export type THintClarity = "whisper" | "subtle" | "suggestive";

export type TDirectionBias = "radial" | "tangential" | "random";

export type TBlendModeKey = "normal" | "additive" | "multiply";

/** Controls which surface areas receive more particles in Beat 5 (Approved). */
export type TSurfaceDepthBias = "uniform" | "crease" | "shadow";

/** Controls how particle size varies based on surface orientation to camera in Beat 5. */
export type TDepthSizing = "flat" | "depth" | "rim";

/** Controls depth/normal opacity variation on swarm (boid) particles. */
export type TDepthOpacityMode = "off" | "subtle" | "strong";
