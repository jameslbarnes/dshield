/**
 * Tests for Isolation Module Index
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { platform } from 'node:os';
import {
  getIsolationCapabilities,
  type IsolationCapabilities,
} from '../../src/isolation/index.js';

describe('Isolation Capabilities', () => {
  describe('getIsolationCapabilities', () => {
    it('should return platform information', () => {
      const caps = getIsolationCapabilities();
      expect(caps.platform).toBe(platform());
    });

    it('should correctly identify non-Linux platforms', () => {
      const caps = getIsolationCapabilities();

      if (platform() !== 'linux') {
        expect(caps.ldPreload).toBe(false);
        expect(caps.networkNamespace).toBe(false);
      }
    });

    it('should return an isolation level', () => {
      const caps = getIsolationCapabilities();
      expect(['full', 'partial', 'minimal']).toContain(caps.isolationLevel);
    });

    it('should have minimal isolation on non-Linux', () => {
      const caps = getIsolationCapabilities();

      if (platform() !== 'linux') {
        expect(caps.isolationLevel).toBe('minimal');
      }
    });

    it('should have consistent capability structure', () => {
      const caps = getIsolationCapabilities();

      expect(caps).toHaveProperty('platform');
      expect(caps).toHaveProperty('networkNamespace');
      expect(caps).toHaveProperty('ldPreload');
      expect(caps).toHaveProperty('seccomp');
      expect(caps).toHaveProperty('isolationLevel');

      expect(typeof caps.platform).toBe('string');
      expect(typeof caps.networkNamespace).toBe('boolean');
      expect(typeof caps.ldPreload).toBe('boolean');
      expect(typeof caps.seccomp).toBe('boolean');
      expect(typeof caps.isolationLevel).toBe('string');
    });
  });
});
