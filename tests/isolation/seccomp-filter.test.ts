/**
 * Tests for Seccomp Filter Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  createStrictProfile,
  createLoggingProfile,
  createParanoidProfile,
  getRecommendedProfile,
} from '../../src/isolation/seccomp-filter.js';

describe('Seccomp Filter', () => {
  describe('createStrictProfile', () => {
    it('should create a profile with ALLOW as default action', () => {
      const profile = createStrictProfile();
      expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');
    });

    it('should include x86_64 and aarch64 architectures', () => {
      const profile = createStrictProfile();
      expect(profile.architectures).toContain('SCMP_ARCH_X86_64');
      expect(profile.architectures).toContain('SCMP_ARCH_AARCH64');
    });

    it('should block dangerous syscalls with ERRNO', () => {
      const profile = createStrictProfile();
      const dangerousRule = profile.syscalls.find(
        (rule) => rule.names.includes('ptrace')
      );
      expect(dangerousRule).toBeDefined();
      expect(dangerousRule?.action).toBe('SCMP_ACT_ERRNO');
    });

    it('should block raw socket creation (AF_PACKET)', () => {
      const profile = createStrictProfile();
      const socketRules = profile.syscalls.filter(
        (rule) => rule.names.includes('socket') && rule.args
      );
      const packetRule = socketRules.find(
        (rule) => rule.args?.some((arg) => arg.value === 17) // AF_PACKET
      );
      expect(packetRule).toBeDefined();
      expect(packetRule?.action).toBe('SCMP_ACT_ERRNO');
    });
  });

  describe('createLoggingProfile', () => {
    it('should create a profile that logs network syscalls', () => {
      const profile = createLoggingProfile();
      expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');

      const loggingRules = profile.syscalls.filter(
        (rule) => rule.action === 'SCMP_ACT_LOG'
      );
      expect(loggingRules.length).toBeGreaterThan(0);
    });

    it('should include socket-related syscalls in logging', () => {
      const profile = createLoggingProfile();
      const networkRule = profile.syscalls.find(
        (rule) => rule.action === 'SCMP_ACT_LOG'
      );
      expect(networkRule?.names).toContain('socket');
      expect(networkRule?.names).toContain('connect');
    });
  });

  describe('createParanoidProfile', () => {
    it('should kill process for dangerous syscalls', () => {
      const profile = createParanoidProfile();
      const killRule = profile.syscalls.find(
        (rule) => rule.action === 'SCMP_ACT_KILL_PROCESS'
      );
      expect(killRule).toBeDefined();
      expect(killRule?.names).toContain('ptrace');
    });

    it('should block AF_INET sockets', () => {
      const profile = createParanoidProfile();
      const inetRule = profile.syscalls.find(
        (rule) =>
          rule.names.includes('socket') &&
          rule.args?.some((arg) => arg.value === 2) // AF_INET
      );
      expect(inetRule).toBeDefined();
      expect(inetRule?.action).toBe('SCMP_ACT_ERRNO');
    });

    it('should block AF_INET6 sockets', () => {
      const profile = createParanoidProfile();
      const inet6Rule = profile.syscalls.find(
        (rule) =>
          rule.names.includes('socket') &&
          rule.args?.some((arg) => arg.value === 10) // AF_INET6
      );
      expect(inet6Rule).toBeDefined();
      expect(inet6Rule?.action).toBe('SCMP_ACT_ERRNO');
    });
  });

  describe('getRecommendedProfile', () => {
    it('should return strict profile by default', () => {
      const profile = getRecommendedProfile();
      expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');

      // Should have blocking rules, not just logging
      const blockingRules = profile.syscalls.filter(
        (rule) => rule.action === 'SCMP_ACT_ERRNO'
      );
      expect(blockingRules.length).toBeGreaterThan(0);
    });

    it('should return logging profile when debug is true', () => {
      const profile = getRecommendedProfile({ debug: true });
      const loggingRules = profile.syscalls.filter(
        (rule) => rule.action === 'SCMP_ACT_LOG'
      );
      expect(loggingRules.length).toBeGreaterThan(0);
    });

    it('should return paranoid profile when paranoid is true', () => {
      const profile = getRecommendedProfile({ paranoid: true });
      const killRules = profile.syscalls.filter(
        (rule) => rule.action === 'SCMP_ACT_KILL_PROCESS'
      );
      expect(killRules.length).toBeGreaterThan(0);
    });
  });
});
