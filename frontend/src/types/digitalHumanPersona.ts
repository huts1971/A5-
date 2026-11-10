export type DigitalHumanIdentity =
  | 'ancient_scholar'
  | 'republican_reporter'
  | 'future_explorer'
  | 'scenic_resident'
  | 'professional_guide'
  | 'local_friend'
  | 'culture_interpreter'
  | 'food_expert'
  | 'photography_guide'
  | 'travel_butler'
  | 'unspecified';

export type DigitalHumanAgeMode = 'group' | 'exact';
export type DigitalHumanAgeGroup = 'teen' | 'young' | 'middle' | 'senior' | 'unspecified';
export type DigitalHumanGender = 'male' | 'female' | 'neutral' | 'unspecified';
export type DigitalHumanPersonality =
  | 'gentle'
  | 'cheerful'
  | 'professional'
  | 'humorous'
  | 'talkative'
  | 'considerate'
  | 'curious'
  | 'calm';
export type DigitalHumanExpressionStyle =
  | 'direct'
  | 'detailed'
  | 'storytelling'
  | 'casual'
  | 'formal'
  | 'poetic'
  | 'interactive'
  | 'unspecified';

export interface DigitalHumanPersonaConfig {
  identity: DigitalHumanIdentity;
  ageMode: DigitalHumanAgeMode;
  ageGroup: DigitalHumanAgeGroup;
  exactAge?: number;
  gender: DigitalHumanGender;
  personalities: DigitalHumanPersonality[];
  expressionStyle: DigitalHumanExpressionStyle;
  creativePrompt: string;
}

export interface DigitalHumanPersona extends DigitalHumanPersonaConfig {
  isCustomized: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_DIGITAL_HUMAN_PERSONA: DigitalHumanPersonaConfig = {
  identity: 'professional_guide',
  ageMode: 'group',
  ageGroup: 'young',
  exactAge: undefined,
  gender: 'unspecified',
  personalities: ['gentle'],
  expressionStyle: 'unspecified',
  creativePrompt: '',
};
