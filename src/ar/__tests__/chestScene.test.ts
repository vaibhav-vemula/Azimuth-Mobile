import { createChestScene } from '../chestScene';

describe('the 3D chest scene', () => {
  it('builds without a graphics context and can be driven for a few frames', () => {
    const s = createChestScene();
    s.setSize(1080, 2340);
    s.setView({ w: 1, x: 0, y: 0, z: 0 });
    s.setChest([0, 0, -12], true);
    s.setMood('ready');
    for (let i = 0; i < 5; i++) s.update(0.016);
    expect(s.hitTest(0, 0)).toEqual(expect.any(Boolean));
    s.open();
    for (let i = 0; i < 80; i++) s.update(0.016);
    expect(s.isOpen()).toBe(true);
    expect(s.openProgress()).toBeGreaterThan(0.99);
    s.dispose();
  });
});
