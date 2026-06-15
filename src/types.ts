export type TDistributionMethod = 'areaWeighted' | 'triangleUniform';

export type TDirectionBias = 'radial' | 'tangential' | 'random';

export type TBlendModeKey = 'normal' | 'additive' | 'multiply';

/** Controls which surface areas receive more particles in Beat 5 (Approved). */
export type TSurfaceDepthBias = 'uniform' | 'crease' | 'shadow';

/** Controls how particle size varies based on surface orientation to camera in Beat 5. */
export type TDepthSizing = 'flat' | 'depth' | 'rim';
