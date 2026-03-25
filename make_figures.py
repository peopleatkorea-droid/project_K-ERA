import sys, json, sqlite3
sys.stdout.reconfigure(encoding='utf-8')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

conn = sqlite3.connect('C:/Users/USER/OneDrive/KERA/KERA_DATA/kera.db')
cur = conn.cursor()
cur.execute("SELECT result_json FROM site_jobs WHERE job_id='job_7c53f4c642'")
data = json.loads(cur.fetchone()[0])
results = data['response']['results']

ARCH_LABEL = {
    'densenet121':       'DenseNet-121',
    'convnext_tiny':     'ConvNeXt-T',
    'efficientnet_v2_s': 'EfficientNet-V2-S',
    'vit':               'ViT-S',
    'swin':              'Swin-T',
    'dinov2':            'DINOv2',
    'dinov2_mil':        'DINOv2-MIL',
    'dual_input_concat': 'Dual-Input',
}
CNN   = {'densenet121', 'convnext_tiny', 'efficientnet_v2_s', 'dual_input_concat'}
TRANS = {'vit', 'swin', 'dinov2', 'dinov2_mil'}

COL_CNN   = '#2196F3'
COL_TRANS = '#FF5722'
HIGHLIGHT = {
    'efficientnet_v2_s': '#1565C0',
    'convnext_tiny':     '#43A047',
    'vit':               '#E53935',
}

def arch_color(a):
    if a in HIGHLIGHT:
        return HIGHLIGHT[a]
    return COL_CNN if a in CNN else COL_TRANS

arch_list, val_auc, test_auc, val_acc, test_acc, bal_acc = [], [], [], [], [], []
roc_data = {}

for r in results:
    a = r['architecture']
    res = r.get('result', {})
    vm  = res.get('val_metrics', {})
    tm  = res.get('test_metrics', {})
    thr = tm.get('threshold_selection_metrics', tm)
    arch_list.append(a)
    val_auc.append(vm.get('AUROC', 0))
    test_auc.append(thr.get('AUROC', 0))
    val_acc.append(vm.get('accuracy', 0))
    test_acc.append(thr.get('accuracy', 0))
    bal_acc.append(thr.get('balanced_accuracy', thr.get('accuracy', 0)))
    roc = tm.get('roc_curve', {})
    if roc:
        roc_data[a] = (roc['fpr'], roc['tpr'], thr.get('AUROC', 0))

# ── Figure 1: ROC Curves ─────────────────────────────────────
HIGHLIGHT_ROC = ['efficientnet_v2_s', 'convnext_tiny', 'vit']

fig1, ax = plt.subplots(figsize=(6.5, 5.5))
ax.plot([0, 1], [0, 1], '--', color='gray', lw=1, label='Random (AUC=0.50)')

order = HIGHLIGHT_ROC + [a for a in arch_list if a not in HIGHLIGHT_ROC]
for a in order:
    if a not in roc_data:
        continue
    fpr, tpr, auc = roc_data[a]
    highlighted = a in HIGHLIGHT_ROC
    lw    = 2.5 if highlighted else 1.2
    alpha = 1.0 if highlighted else 0.45
    lbl   = f'{ARCH_LABEL[a]} (AUC={auc:.3f})'
    ax.plot(fpr, tpr, color=arch_color(a), lw=lw, alpha=alpha, label=lbl,
            zorder=3 if highlighted else 1)

ax.set_xlabel('False Positive Rate', fontsize=11)
ax.set_ylabel('True Positive Rate', fontsize=11)
ax.set_title('Figure 1. ROC Curves — CNN vs Transformer', fontsize=12, fontweight='bold')
ax.legend(fontsize=7.5, loc='lower right')
ax.set_xlim([-0.02, 1.02])
ax.set_ylim([-0.02, 1.05])
ax.grid(True, alpha=0.3)

patch_cnn   = mpatches.Patch(color=COL_CNN,   label='CNN-based')
patch_trans = mpatches.Patch(color=COL_TRANS, label='Transformer-based')
fig1.legend(handles=[patch_cnn, patch_trans], loc='upper left',
            bbox_to_anchor=(0.13, 0.92), fontsize=8, framealpha=0.8)
fig1.tight_layout()
fig1.savefig('C:/Users/USER/Downloads/fig1_roc.png', dpi=180, bbox_inches='tight')
print('Fig1 saved -> C:/Users/USER/Downloads/fig1_roc.png')

# ── Figure 2: Generalization Gap ─────────────────────────────
gap = [v - t for v, t in zip(val_acc, test_acc)]
idx = np.arange(len(arch_list))
labels_bar = [ARCH_LABEL[a] for a in arch_list]
colors_bar = [arch_color(a) for a in arch_list]

fig2, axes = plt.subplots(1, 2, figsize=(12, 4.8))

ax = axes[0]
w = 0.35
ax.bar(idx - w/2, val_acc,  w, label='Val Acc',
       color=[c + '80' for c in colors_bar], edgecolor=colors_bar, linewidth=1.2)
ax.bar(idx + w/2, test_acc, w, label='Test Acc',
       color=colors_bar, edgecolor='black', linewidth=0.5)
ax.set_xticks(idx)
ax.set_xticklabels(labels_bar, rotation=32, ha='right', fontsize=8)
ax.set_ylabel('Accuracy', fontsize=10)
ax.set_ylim([0, 1.0])
ax.set_title('Val Accuracy vs Test Accuracy', fontsize=11, fontweight='bold')
ax.legend(fontsize=9)
ax.grid(axis='y', alpha=0.3)

ax = axes[1]
ax.bar(idx, gap, color=colors_bar, edgecolor='black', linewidth=0.5, alpha=0.85)
ax.axhline(0, color='black', lw=0.8)
for i, (g, a) in enumerate(zip(gap, arch_list)):
    ax.text(i, g + (0.003 if g >= 0 else -0.015), f'{g:+.3f}',
            ha='center', va='bottom' if g >= 0 else 'top', fontsize=7.5)
ax.set_xticks(idx)
ax.set_xticklabels(labels_bar, rotation=32, ha='right', fontsize=8)
ax.set_ylabel('Val Acc − Test Acc  (Generalization Gap)', fontsize=9)
ax.set_title('Figure 2. Generalization Gap', fontsize=11, fontweight='bold')
ax.grid(axis='y', alpha=0.3)

patch_cnn   = mpatches.Patch(color=COL_CNN,   label='CNN-based')
patch_trans = mpatches.Patch(color=COL_TRANS, label='Transformer-based')
axes[1].legend(handles=[patch_cnn, patch_trans], fontsize=8, loc='upper right')

fig2.tight_layout()
fig2.savefig('C:/Users/USER/Downloads/fig2_gap.png', dpi=180, bbox_inches='tight')
print('Fig2 saved -> C:/Users/USER/Downloads/fig2_gap.png')

# ── Figure 3: Model Ranking ───────────────────────────────────
sort_idx = np.argsort(test_auc)[::-1]
s_arch  = [arch_list[i] for i in sort_idx]
s_auc   = [test_auc[i]  for i in sort_idx]
s_bal   = [bal_acc[i]   for i in sort_idx]
s_label = [ARCH_LABEL[a] for a in s_arch]
s_col   = [arch_color(a) for a in s_arch]

x = np.arange(len(s_arch))
w = 0.38

fig3, ax = plt.subplots(figsize=(8.5, 5))
b1 = ax.bar(x - w/2, s_auc, w, label='AUROC',
            color=s_col, edgecolor='black', linewidth=0.5)
b2 = ax.bar(x + w/2, s_bal, w, label='Balanced Accuracy',
            color=s_col, edgecolor='black', linewidth=0.5, hatch='//', alpha=0.75)

for bar in b1:
    h = bar.get_height()
    ax.text(bar.get_x() + bar.get_width() / 2, h + 0.006,
            f'{h:.3f}', ha='center', va='bottom', fontsize=7)
for bar in b2:
    h = bar.get_height()
    ax.text(bar.get_x() + bar.get_width() / 2, h + 0.006,
            f'{h:.3f}', ha='center', va='bottom', fontsize=7)

ax.axhline(0.5, color='gray', lw=1, linestyle='--', label='Random baseline (0.50)')
ax.set_xticks(x)
ax.set_xticklabels(s_label, rotation=25, ha='right', fontsize=9)
ax.set_ylabel('Score', fontsize=11)
ax.set_ylim([0, 1.0])
ax.set_title('Figure 3. Model Ranking — AUROC & Balanced Accuracy', fontsize=12, fontweight='bold')
ax.legend(fontsize=9, loc='upper right')
ax.grid(axis='y', alpha=0.3)

patch_cnn   = mpatches.Patch(color=COL_CNN,   label='CNN-based')
patch_trans = mpatches.Patch(color=COL_TRANS, label='Transformer-based')
fig3.legend(handles=[patch_cnn, patch_trans], loc='upper right',
            bbox_to_anchor=(0.98, 0.88), fontsize=8, framealpha=0.8)

fig3.tight_layout()
fig3.savefig('C:/Users/USER/Downloads/fig3_ranking.png', dpi=180, bbox_inches='tight')
print('Fig3 saved -> C:/Users/USER/Downloads/fig3_ranking.png')

print()
print('=== Generalization Gap 수치 ===')
for a, g in zip(arch_list, gap):
    kind = 'Transformer' if a in TRANS else 'CNN'
    print(f'  {ARCH_LABEL[a]:<22} {kind:<12}  gap = {g:+.4f}')
