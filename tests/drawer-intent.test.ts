import {afterEach,expect,it,vi} from 'vitest';
import {DrawerIntent} from '../src/components/drawer-intent';

afterEach(()=>vi.useRealTimers());
it('sweeping across tiles does no Shell work; only the settled tile is prepared and handed off',()=>{
  vi.useFakeTimers();const prepare=vi.fn(async()=>{}),discard=vi.fn(async()=>{}),intent=new DrawerIntent(prepare,discard);
  for(const id of ['a','b','c']){intent.aim(id);vi.advanceTimersByTime(40);intent.clear(id);}
  expect(prepare).not.toHaveBeenCalled();intent.aim('d');vi.advanceTimersByTime(250);
  expect(prepare).toHaveBeenCalledTimes(1);const token=intent.take('d');expect(prepare).toHaveBeenCalledWith('d',token);
  intent.clear();expect(discard).not.toHaveBeenCalled();expect(intent.take('d')).toBeUndefined();
});
it('a new press supersedes a hovered item; leaving or scrolling cancels outstanding preparation',()=>{
  vi.useFakeTimers();const prepare=vi.fn(async(_id:string,_token:string)=>{}),discard=vi.fn(async()=>{}),intent=new DrawerIntent(prepare,discard);
  intent.aim('a',true);intent.aim('b',true);intent.clear('a');expect(discard).toHaveBeenCalledTimes(1);
  intent.clear();expect(discard).toHaveBeenCalledWith(prepare.mock.calls[1][1]);
  intent.aim('c');intent.clear();vi.advanceTimersByTime(1000);expect(prepare).toHaveBeenCalledTimes(2);
});
