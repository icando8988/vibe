// Work around the CLI's non-ASCII OS hostname in its HTTP User-Agent.
// This affects this Node process only; no OS or authentication settings change.
require('node:os').hostname = () => 'vibe-workstation';
require('node:module').syncBuiltinESMExports();
