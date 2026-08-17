import { describe, expect, it } from 'vitest';
import { initialModalAnimState } from '../../components/ui/Modal';
describe('Modal initial lifecycle', () => { it('mounts visible when first rendered already open', () => { expect(initialModalAnimState(true)).toBe('entering'); }); it('stays unmounted when first rendered closed', () => { expect(initialModalAnimState(false)).toBe('closed'); }); });