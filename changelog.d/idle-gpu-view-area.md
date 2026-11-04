- Reduce idle frontend work without lowering the 60 FPS interaction target.
  Cyber's voice scanner runs only while voice is active and moves with a
  transform instead of forcing layout. Its sonar sweep rotates a smaller
  surface while preserving its timing and appearance. Civil and military
  aircraft outside the view plus a quarter-viewport margin skip visual updates
  and new model loads; current motion estimates and tracked rendering continue,
  and cached models remain eligible for reuse during return pans.
