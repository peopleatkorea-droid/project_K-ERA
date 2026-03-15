# CSS Design System Plan

## 목적

이 문서는 현재 `frontend/app/styles/*.css` 기반 스타일 구조를 유지하면서, 공통 UI 레이어와 디자인 규칙을 단계적으로 정리하기 위한 1차 설계안이다.

목표는 세 가지다.

1. `CaseWorkspace`와 `AdminWorkspace`에서 반복되는 UI 패턴을 공통 컴포넌트로 흡수한다.
2. 색상, 간격, radius, shadow, 타이포그래피를 토큰으로 고정해 화면 간 일관성을 높인다.
3. 대규모 재작성 없이 현재 CSS 자산을 보존한 채 점진적으로 마이그레이션한다.

이 설계안은 `Tailwind` 전환이 아니라, 기존 CSS 자산 위에 `token -> primitive -> section pattern` 계층을 올리는 방식을 전제로 한다.

## 현재 상태 요약

현재 프론트 스타일은 아래 구조로 동작한다.

- 전역 기본 토큰과 리셋: [frontend/app/styles/base.css](c:/Users/USER/Downloads/project_K-ERA/frontend/app/styles/base.css)
- 퍼블릭/랜딩 스타일: [frontend/app/styles/public-shell.css](c:/Users/USER/Downloads/project_K-ERA/frontend/app/styles/public-shell.css)
- 운영/케이스 워크스페이스 스타일: [frontend/app/styles/workspace.css](c:/Users/USER/Downloads/project_K-ERA/frontend/app/styles/workspace.css)

이미 좋은 기반도 있다.

- `--color-accent`, `--surface-panel`, `--text-muted` 같은 전역 CSS 변수 존재
- `ghost-button`, `primary-workspace-button`, `doc-surface`, `ops-card`, `panel-metric-grid`, `empty-surface` 같은 반복 패턴 존재
- `light/dark` 테마 전환이 `data-workspace-theme` 기준으로 이미 일부 적용됨

문제는 CSS가 없어서가 아니라, 공통 UI 규칙이 코드 레벨에서 아직 충분히 고정되지 않았다는 점이다.

## 핵심 문제

현재 구조에서 유지보수 비용을 키우는 요인은 아래와 같다.

1. 같은 의미의 UI가 클래스 조합만 다르게 여러 곳에 흩어져 있다.
2. 버튼, 카드, 필드, 메트릭 영역이 컴포넌트가 아니라 관례에 의존한다.
3. 스타일 토큰이 `base.css`와 `workspace.css`에 나뉘어 있고, naming 계층이 일관되게 정리돼 있지 않다.
4. `AdminWorkspace`와 `CaseWorkspace`가 같은 시각 언어를 쓰지만, 구현은 각자 조금씩 다르다.
5. 상태 표현 로딩, 빈 상태, 오류, 선택, 비활성 규칙이 아직 공통 컴포넌트로 고정되지 않았다.

## 디자인 시스템 목표 구조

권장 계층은 아래와 같다.

1. `Design tokens`
2. `UI primitives`
3. `Composite patterns`
4. `Screen sections`

### 1. Design tokens

토큰은 시각 결정을 코드에서 일관되게 재사용하기 위한 가장 낮은 계층이다.

권장 파일 구조:

```text
frontend/
  app/
    styles/
      base.css
      tokens.css
      themes.css
      public-shell.css
      workspace.css
```

권장 역할:

- `base.css`: reset, element defaults, font family, root import
- `tokens.css`: spacing, radius, color, text, shadow, z-index, motion
- `themes.css`: dark/light theme override
- `public-shell.css`: 퍼블릭 페이지 레이아웃/조합 스타일
- `workspace.css`: 워크스페이스 전용 레이아웃/조합 스타일

권장 토큰 그룹:

```css
:root {
  --ds-color-accent: #7dd3c3;
  --ds-color-accent-strong: #49b7a5;
  --ds-color-danger: #f4a49a;

  --ds-surface-app: #0f1318;
  --ds-surface-panel: rgba(21, 25, 33, 0.88);
  --ds-surface-panel-strong: rgba(28, 33, 41, 0.96);
  --ds-surface-muted: rgba(255, 255, 255, 0.04);
  --ds-border-subtle: rgba(255, 255, 255, 0.09);

  --ds-text-primary: #f4f7fb;
  --ds-text-secondary: #96a3b3;

  --ds-space-1: 4px;
  --ds-space-2: 8px;
  --ds-space-3: 12px;
  --ds-space-4: 16px;
  --ds-space-5: 20px;
  --ds-space-6: 24px;
  --ds-space-7: 32px;
  --ds-space-8: 40px;

  --ds-radius-sm: 10px;
  --ds-radius-md: 14px;
  --ds-radius-lg: 20px;
  --ds-radius-xl: 28px;
  --ds-radius-pill: 999px;

  --ds-shadow-card: 0 24px 80px rgba(0, 0, 0, 0.34);
  --ds-shadow-overlay: 0 32px 90px rgba(0, 0, 0, 0.28);

  --ds-font-size-label: 0.78rem;
  --ds-font-size-body: 0.95rem;
  --ds-font-size-title: 1.25rem;
  --ds-font-size-display: clamp(2.8rem, 4vw, 4.8rem);

  --ds-motion-fast: 160ms ease;
  --ds-motion-base: 220ms ease;
}
```

토큰 정리 원칙:

- 기존 `--color-*`, `--surface-*`, `--text-*`를 즉시 삭제하지 않는다.
- 새 `--ds-*` 토큰을 먼저 추가하고, 기존 변수는 점진적으로 alias 처리한다.
- 화면 클래스에서 raw color literal 사용을 줄이고 토큰 참조로 교체한다.

### 2. UI primitives

가장 먼저 만들 공통 컴포넌트는 아래 7개다.

```text
frontend/components/ui/
  button.tsx
  card.tsx
  section-header.tsx
  field.tsx
  badge.tsx
  empty-state.tsx
  metric-grid.tsx
```

권장 우선순위:

1. `Button`
2. `Card`
3. `SectionHeader`
4. `Field`
5. `EmptyState`
6. `MetricGrid`
7. `Badge`

#### Button

현재 흩어진 `ghost-button`, `primary-workspace-button`, `compact-ghost-button`를 흡수한다.

권장 API:

```tsx
<Button variant="primary" size="md" />
<Button variant="ghost" size="sm" />
<Button variant="danger" size="md" />
```

지원 상태:

- `default`
- `hover`
- `active`
- `disabled`
- `loading`

#### Card

현재 `workspace-card`, `doc-surface`, `ops-card`, `panel-card`를 역할별로 정리한다.

권장 variant:

- `surface`
- `panel`
- `nested`
- `interactive`

권장 서브 구조:

```tsx
<Card variant="surface">
  <Card.Header />
  <Card.Body />
  <Card.Footer />
</Card>
```

#### Field

폼 품질과 일관성 확보의 핵심이다.

지원해야 할 항목:

- `label`
- `hint`
- `error`
- `required`
- `disabled`
- `inline` / `stacked`

확장 대상:

- text input
- textarea
- select
- multi-select
- checkbox/toggle

### 3. Composite patterns

primitive 위에 워크스페이스에서 반복되는 조합 패턴을 올린다.

권장 후보:

```text
frontend/components/ui/patterns/
  action-row.tsx
  stats-grid.tsx
  status-inline.tsx
  property-list.tsx
  selection-list.tsx
  progress-card.tsx
```

현재 코드에서 바로 대응되는 클래스:

- `workspace-actions` -> `ActionRow`
- `panel-metric-grid` -> `StatsGrid`
- `empty-surface` -> `EmptyState`
- `panel-card-head` / `doc-title-row` -> `SectionHeader`
- `ops-list` / `ops-item` -> `SelectionList`

### 4. Screen sections

이 단계부터 `AdminWorkspace`와 `CaseWorkspace` 하위 컴포넌트가 `ui/`를 조합해 렌더하게 만든다.

적용 순서:

1. `frontend/components/admin-workspace/dashboard-section.tsx`
2. `frontend/components/admin-workspace/training-section.tsx`
3. `frontend/components/case-workspace/patient-visit-form.tsx`
4. `frontend/components/case-workspace/image-manager-panel.tsx`
5. 나머지 section

이 순서가 좋은 이유는 공통 카드, 버튼, 메트릭, 폼 패턴이 가장 많이 드러나는 화면부터 정리할 수 있기 때문이다.

## 토큰 설계 원칙

### 색상

- `semantic token` 중심으로 간다.
- `mint`, `white`, `gray` 같은 원색 이름보다 `surface`, `border`, `text`, `accent`, `danger`, `success`, `warning`를 우선한다.

예:

- `--ds-color-accent`
- `--ds-surface-panel`
- `--ds-border-subtle`
- `--ds-text-secondary`

### 간격

- 4px base spacing scale 사용
- 컴포넌트 내부 여백은 토큰만 사용
- magic number 13px, 18px, 22px 같은 값은 점진적으로 줄인다

### radius

- 버튼, 필드, 카드에 각각 별도 radius를 두지 말고 토큰 그룹으로 제한한다
- 권장 그룹: `sm`, `md`, `lg`, `xl`, `pill`

### shadow

- 그림자는 2~3종으로 제한한다
- 카드, 오버레이, 강조형 버튼 정도만 별도 shadow를 둔다

### motion

- hover, focus, selection, panel reveal에만 제한적으로 사용
- generic micro-animation 남발 금지

## 컴포넌트 규칙

### Button 규칙

- primary action은 화면당 한 블록에 1개를 기본으로 한다
- secondary action은 `ghost`
- destructive action은 `danger`
- 버튼 너비는 내용 기반을 기본으로 하고, rail/action bar에서만 full width 허용

### Card 규칙

- 화면의 최상위 섹션은 `surface`
- 섹션 내부 반복 아이템은 `nested` 또는 `interactive`
- clickable item은 hover, focus, selected 상태가 동일 규칙을 따라야 한다

### Field 규칙

- 라벨과 입력 컴포넌트는 항상 같은 구조를 사용한다
- 오류 문구 위치는 입력 아래로 고정한다
- 설명 문구와 placeholder를 혼용하지 않는다

### Metric 규칙

- 숫자가 핵심인 경우만 `MetricGrid` 사용
- 설명 위주 블록은 일반 카드로 처리
- metric label은 소문자/짧은 문구로 제한

## 테마 전략

현재 워크스페이스는 dark/light 테마 전환을 이미 갖고 있으므로 이를 유지하되, override 위치를 명확히 한다.

권장 방식:

```css
:root {
  /* default theme tokens */
}

[data-theme="light"] {
  /* light theme overrides */
}

[data-theme="dark"] {
  /* dark theme overrides if needed */
}
```

적용 원칙:

- 컴포넌트 CSS는 theme-aware token만 사용
- 컴포넌트 안에서 dark/light literal 분기 금지
- 현재 `data-workspace-theme`는 점진적으로 `data-theme`로 수렴 가능

## 파일 구조 제안

권장 1차 구조:

```text
frontend/
  app/
    styles/
      base.css
      tokens.css
      themes.css
      public-shell.css
      workspace.css
  components/
    ui/
      button.tsx
      button.css
      card.tsx
      card.css
      section-header.tsx
      field.tsx
      field.css
      badge.tsx
      empty-state.tsx
      metric-grid.tsx
      patterns/
        action-row.tsx
        progress-card.tsx
```

중요한 점은 처음부터 CSS Module이나 CSS-in-JS로 옮기지 않는 것이다. 먼저 공통 컴포넌트를 만든 뒤, 필요하면 나중에 내부 구현 방식만 바꿀 수 있다.

## 단계별 마이그레이션 계획

### Phase 0. 토큰 정리

예상: 0.5~1일

- `tokens.css`, `themes.css` 추가
- 기존 `base.css`, `workspace.css` 변수 alias 정리
- raw literal 빈도가 높은 구간부터 토큰 치환 시작

완료 기준:

- 새 토큰 파일 존재
- 주요 색상/spacing/radius/shadow가 토큰화됨

### Phase 1. Primitive 도입

예상: 2~3일

- `Button`, `Card`, `SectionHeader`, `Field` 구현
- `EmptyState`, `MetricGrid`, `Badge` 구현
- 테스트 추가

완료 기준:

- 클래스 직접 조합 없이 primitive로 같은 UI를 재현 가능

### Phase 2. 운영 화면 우선 적용

예상: 2~3일

- `dashboard-section.tsx`
- `training-section.tsx`
- `management-section.tsx`

완료 기준:

- 운영 화면 주요 카드/버튼/메트릭이 공통 UI 사용

### Phase 3. 케이스 화면 적용

예상: 3~4일

- `patient-visit-form.tsx`
- `image-manager-panel.tsx`
- `validation-panel.tsx`
- `ai-clinic-panel.tsx`

완료 기준:

- 저장 흐름, 이미지 흐름, 검증 흐름의 폼/액션 구조가 공통화됨

### Phase 4. 문서화 및 lint/test 보강

예상: 1~2일

- 사용 규칙 문서 작성
- 시각 회귀 방지용 테스트 보강
- primitive snapshot 또는 interaction test 추가

## 테스트 전략

디자인 시스템도 테스트가 필요하다.

권장 범위:

- `Button`: variant, disabled, loading
- `Field`: label, hint, error, disabled
- `Card`: header/body/footer 렌더
- `MetricGrid`: item count와 responsive class
- `AdminWorkspace`/`CaseWorkspace`: primitive 적용 후 핵심 flow smoke test

추가로 고려할 것:

- 시각 회귀 테스트는 1차에서는 선택
- 우선은 interaction test와 class/aria 중심 검증이 현실적

## 성공 지표

1차 도입 완료 시 아래를 목표로 한다.

1. 워크스페이스 주요 버튼의 80% 이상이 `Button` 사용
2. 반복 카드 레이아웃의 70% 이상이 `Card` 기반
3. 신규 폼 입력은 `Field` 계열만 사용
4. raw literal color 사용 빈도 유의미하게 감소
5. `workspace.css`가 레이아웃/스크린 규칙 중심으로 축소됨

## 하지 않을 것

이번 설계안 범위에서 제외한다.

- Tailwind 전면 전환
- 전체 화면 재디자인
- 새로운 디자인 툴 체계 Figma token sync 등 도입
- CSS-in-JS 전환
- 모든 기존 클래스를 한 번에 제거

## 권장 시작점

바로 구현을 시작한다면 아래 순서가 가장 안전하다.

1. `tokens.css`, `themes.css` 추가
2. `Button`, `Card`, `Field` 구현
3. `dashboard-section.tsx`에 먼저 적용
4. `patient-visit-form.tsx`와 `image-manager-panel.tsx`에 적용
5. 테스트 추가 후 나머지 섹션 확장

## 결론

현재 프로젝트는 CSS를 버리고 새 스타일 시스템으로 갈아타야 하는 단계가 아니다. 이미 존재하는 `base.css`, `public-shell.css`, `workspace.css` 위에 공통 토큰과 UI primitive를 올리면, 가장 적은 리스크로 일관성과 개발 속도를 동시에 개선할 수 있다.

이 설계안의 핵심은 재작성보다 `점진적 흡수`다.
