import { useEffect, useState } from 'react';
import type { AppState } from '../shared/types';
import { api, errorMessage } from './api';

export function useAppState() {
  const [state,setState]=useState<AppState|null>(null),[loadError,fail]=useState('');
  useEffect(()=>{
    let live=true,updated=false;
    const off=api.onStateChange(s=>{updated=true;if(live){setState(s);fail('');}});
    void api.getState().then(s=>{if(live&&!updated)setState(s);}).catch(e=>{if(live&&!updated)fail(errorMessage(e));});
    return()=>{live=false;off();};
  },[]);
  return {state,loadError};
}
