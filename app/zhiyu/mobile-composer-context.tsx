'use client';

import {createContext} from 'react';

/** A route-local switch. Desktop consumers retain their existing markup. */
export const MobileComposerContext=createContext(false);
