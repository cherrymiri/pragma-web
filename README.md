# PRAGMA — 오래된 사랑 · When Love Responds

졸업작품 〈When Love Responds, 사랑의 응답〉의 PRAGMA 인터랙티브 3D 웹입니다.
오프닝, 물 따르기, 뚜껑 조절, 기울이기, 누수 판정과 재조절, 성공 연출, 엔딩까지 전체 흐름이 구현되어 있습니다.

- React + Three.js + Vite, Vercel 배포
- 모델: `public/models/PRAGMA_Tumbler.glb` (Blender 원본에서 내보낸 파일, 유리·물 재질만 웹 전용으로 교체)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## 판정 값

- `SEAL_LOCK` (`src/stage/Stage.js`): 실제 텀블러처럼 끝까지 잠가야 새지 않습니다.
- 판정은 물이 뚜껑의 밀폐부에 실제로 닿았을 때만 시작합니다(`Cavity.sealWet`). 물의 양은 결과에 영향을 주지 않습니다.
- 물은 안쪽 벽 형상에서 읽은 공간 안의 부피로 계산합니다(`src/stage/liquid.js`).

## 상태값 (`src/store.js`)

`step`, `waterLevel`, `isPouring`, `hasPoured`, `lidPosition`, `lidMode`, `lidAligned`, `lidRotation`, `lidTurns`, `lidLock`, `canTilt`, `tiltAngle`, `sealWet`, `verdict`, `leakage`, `ended`

## 테스트

`npm run preview` 뒤 `node tests/e2e2.mjs http://localhost:4173/`

## 구성

- `src/opening/Opening.jsx`: 다른 사랑 사이트에서도 쓰는 공통 오프닝 (문구와 포인트 색만 props로 전달)
- `src/stage/leak.js`: 뚜껑이 열린 정도, 밀폐부의 수심, 기울기에 따라 연속적으로 변하는 누수, 성공 시 접합부 빛
- `src/sound.js`: 브라우저에서 직접 합성하는 소리 (녹음 파일 없음), 체험 시작 버튼 이후 재생
- `tests/look4.mjs`: 누수 단계별 화면 캡처
