# PRAGMA — 오래된 사랑 · When Love Responds

졸업작품 〈When Love Responds, 사랑의 응답〉의 PRAGMA 인터랙티브 3D 웹입니다.
현재는 **1차 구현**(물 따르기, 뚜껑 정렬과 돌려 닫기)까지입니다. 기울이기, 누수, 성공 연출은 아직 없습니다.

- React + Three.js + Vite, Vercel 배포
- 모델: `public/models/PRAGMA_Tumbler.glb` (Blender 원본에서 내보낸 파일, 유리·물 재질만 웹 전용으로 교체)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## 2차 구현에서 쓸 상태값 (`src/store.js`)

`waterLevel`, `isPouring`, `hasPoured`, `lidPosition`, `lidMode`, `lidAligned`, `lidRotation`, `lidTurns`, `lidLock`, `step`

`lidLock`은 0(나사에 막 얹힘)에서 1(완전히 닫힘)까지의 연속값으로, 누수 판정에 그대로 쓸 수 있습니다.
