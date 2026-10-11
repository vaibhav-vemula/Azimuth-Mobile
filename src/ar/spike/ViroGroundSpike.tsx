// Gate A test: a box that must stay fixed on the floor. Removed once the real chest view has passed Gate B.
import { useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { ViroAmbientLight, ViroARScene, ViroARSceneNavigator, ViroBox, ViroDirectionalLight, ViroMaterials, ViroNode } from '@reactvision/react-viro';

ViroMaterials.createMaterials({ spikeWood: { diffuseColor: '#8B5A2B', lightingModel: 'Blinn' } });

type Pos = [number, number, number];

function GroundScene() {
  const sceneRef = useRef<any>(null);
  const [chestPos, setChestPos] = useState<Pos | null>(null);
  const { width, height } = Dimensions.get('window');

  const place = async () => {
    const results = await sceneRef.current?.performARHitTestWithPoint(width / 2, height / 2);
    const hit = results?.find((r: any) => r.type === 'ExistingPlaneUsingExtent' || r.type === 'ExistingPlane');
    if (hit) {
      const p = hit.transform.position;
      setChestPos([p[0], p[1], p[2]]);
    }
  };

  return (
    <ViroARScene ref={sceneRef} anchorDetectionTypes={['PlanesHorizontal']} onAnchorFound={() => { if (!chestPos) place().catch(() => {}); }} onClick={() => { place().catch(() => {}); }}>
      <ViroAmbientLight color="#ffffff" intensity={400} />
      <ViroDirectionalLight color="#ffffff" direction={[0, -1, -0.3]} />
      {chestPos ? (
        <ViroNode position={chestPos}>
          <ViroBox position={[0, 0.15, 0]} scale={[0.6, 0.3, 0.4]} materials={['spikeWood']} />
        </ViroNode>
      ) : null}
    </ViroARScene>
  );
}

export default function ViroGroundSpike() {
  const [started] = useState(true);
  return (
    <View style={styles.fill}>
      {started ? <ViroARSceneNavigator autofocus initialScene={{ scene: GroundScene }} style={styles.fill} /> : null}
      <View style={styles.hint} pointerEvents="none">
        <Text style={styles.text}>Point at the floor. The box appears on it. Tap to place it again. Walk around it.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hint: { position: 'absolute', bottom: 48, left: 16, right: 16, alignItems: 'center' },
  text: { color: '#fff', backgroundColor: '#000a', padding: 8, borderRadius: 8, textAlign: 'center' },
});
