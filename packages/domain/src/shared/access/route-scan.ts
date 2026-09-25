import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { readRouteAccess, ROUTE_MARKER_KEYS, type RouteAccess } from './markers';

export interface RouteAccessEntry {
  controller: string;
  handler: string;
  method: string;
  path: string;
  access: RouteAccess;
  classMarkers: string[];
}

const join = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/')}`;

/** Test helper: every route of the app with its access marker (needs DiscoveryModule imported). */
export function scanRouteAccess(app: INestApplication, globalPrefix = 'api'): RouteAccessEntry[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const entries: RouteAccessEntry[] = [];
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as object | undefined;
    const metatype = wrapper.metatype;
    if (!instance || !metatype) continue;
    const controllerPath = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    const classMarkers = ROUTE_MARKER_KEYS.filter(
      (key) => Reflect.getMetadata(key, metatype) !== undefined,
    );
    const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (methodPath === undefined || method === undefined) continue;
      entries.push({
        controller: metatype.name,
        handler: name,
        method: RequestMethod[method],
        path: join(globalPrefix, controllerPath, methodPath),
        access: readRouteAccess(reflector, handler),
        classMarkers: [...classMarkers],
      });
    }
  }
  return entries;
}
