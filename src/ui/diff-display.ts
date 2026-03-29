/**
 * diff-display.ts
 *
 * Computes the difference between two versions of a PackageCapability profile.
 * Used during `safenpm install` when a package is being updated — shows users
 * exactly what new access a package is requesting compared to its previous version.
 */

import type { PackageCapability } from '../capabilities/schema'

export interface ProfileDiff {
  fsReadAdded: string[]
  fsReadRemoved: string[]
  fsWriteAdded: string[]
  fsWriteRemoved: string[]
  netHostsAdded: string[]
  netHostsRemoved: string[]
  netOutboundChanged: boolean
  envAdded: string[]
  envRemoved: string[]
  spawnChanged: boolean
  nativeModulesChanged: boolean
  /** true if any field changed */
  hasChanges: boolean
}

/**
 * Computes a structured diff between an old and new PackageCapability profile.
 */
export function diffProfiles(
  oldProfile: PackageCapability,
  newProfile: PackageCapability
): ProfileDiff {
  const fsReadAdded = arrayDiff(oldProfile.fs.read, newProfile.fs.read)
  const fsReadRemoved = arrayDiff(newProfile.fs.read, oldProfile.fs.read)
  const fsWriteAdded = arrayDiff(oldProfile.fs.write, newProfile.fs.write)
  const fsWriteRemoved = arrayDiff(newProfile.fs.write, oldProfile.fs.write)
  const netHostsAdded = arrayDiff(oldProfile.net.hosts, newProfile.net.hosts)
  const netHostsRemoved = arrayDiff(newProfile.net.hosts, oldProfile.net.hosts)
  const netOutboundChanged = oldProfile.net.outbound !== newProfile.net.outbound
  const envAdded = arrayDiff(oldProfile.env, newProfile.env)
  const envRemoved = arrayDiff(newProfile.env, oldProfile.env)
  const spawnChanged = oldProfile.child_process.allowed !== newProfile.child_process.allowed
  const nativeModulesChanged = oldProfile.hasNativeModules !== newProfile.hasNativeModules

  const hasChanges =
    fsReadAdded.length > 0 || fsReadRemoved.length > 0 ||
    fsWriteAdded.length > 0 || fsWriteRemoved.length > 0 ||
    netHostsAdded.length > 0 || netHostsRemoved.length > 0 ||
    netOutboundChanged || envAdded.length > 0 || envRemoved.length > 0 ||
    spawnChanged || nativeModulesChanged

  return {
    fsReadAdded, fsReadRemoved,
    fsWriteAdded, fsWriteRemoved,
    netHostsAdded, netHostsRemoved,
    netOutboundChanged,
    envAdded, envRemoved,
    spawnChanged,
    nativeModulesChanged,
    hasChanges,
  }
}

/** Returns elements that are in `next` but not in `prev`. */
function arrayDiff(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev)
  return next.filter(item => !prevSet.has(item))
}
