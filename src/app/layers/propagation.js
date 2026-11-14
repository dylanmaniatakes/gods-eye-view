import { createPropagationLayer } from '../../layers/propagation/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as render from '../../renderGovernor.js';

/** Construct one observed propagation display using application scene owners. */
export function createApplicationPropagation({ source, vhf = false }) {
  return createPropagationLayer({
    source,
    vhf,
    services: { picking, render },
  });
}

/** Construct the HF propagation display. */
export function createApplicationHfPropagation({ source }) {
  return createApplicationPropagation({ source, vhf: false });
}

/** Construct the observed 2 m propagation display. */
export function createApplicationVhfPropagation({ source }) {
  return createApplicationPropagation({ source, vhf: true });
}
