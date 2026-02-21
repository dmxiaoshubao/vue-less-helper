export interface LessVariable {
  name: string;
  value: string;
  position: { line: number, character: number };
  uri?: string;
  importUri?: string;
}

export interface LessMixin {
  name: string;
  params: string;
  body: string;
  position: { line: number, character: number };
  uri?: string;
  importUri?: string;
}
