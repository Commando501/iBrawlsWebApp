import { createContext, useContext } from 'react';

/** Published admin policy; saved player settings never grant access to variants. */
export const ModelVariantsContext = createContext(false);

export function useModelVariantsEnabled(): boolean {
  return useContext(ModelVariantsContext);
}
