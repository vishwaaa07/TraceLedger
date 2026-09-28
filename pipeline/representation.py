"""Inductive, past-only graph representation. Mean aggregation + fitted PCA.

This is a small attributed-graph embedding, not Node2Vec/GraphSAGE or ownership
inference. Each vector describes self, earlier parents and their earlier parents.
"""
import math
from bisect import bisect_left
from datetime import datetime
import numpy as np

BASE = ['log_output_sats','input_count','output_count','log_fee_sats',
        'largest_output_share','output_cv','prior_address_1h','prior_parent_count']
CONTEXT = ['log_parent_gap_seconds','prior_chain_depth','parent_mean_output_share',
           'prior_fast_chain','prior_retained_chain']
FEATURES = BASE + CONTEXT + [f'graph_embedding_{i+1}' for i in range(4)]

def raw_features(rows):
    txs = {r['txid']: r for r in rows}
    ordered = sorted(txs.values(), key=lambda t:(datetime.fromisoformat(t['timestamp']).timestamp(),t['txid']))
    history, seen, signatures, ids, raw, graph = {}, {}, {}, [], [], []
    for t in ordered:
        now = datetime.fromisoformat(t['timestamp']).timestamp()
        amounts = t['output_amounts']; total=sum(amounts); mean=total/len(amounts)
        share=max(amounts)/total if total else 0
        cv=math.sqrt(sum((a-mean)**2 for a in amounts)/len(amounts))/mean if mean else 0
        addresses=set(t['input_addresses']+t['output_addresses'])
        activity=sum(bisect_left(history.get(a,[]),now)-bisect_left(history.get(a,[]),now-3600) for a in addresses)
        parents=[seen[i.get('prev_txid')] for i in t['inputs'] if i.get('prev_txid') in seen and seen[i['prev_txid']]['time']<now]
        gap=min((now-p['time'] for p in parents),default=86400)
        depth=1+max((p['depth'] for p in parents),default=-1)
        fast=1+max((p['fast'] for p in parents),default=0) if parents and gap<60 else 0
        retained=1+max((p['retained'] for p in parents),default=0) if parents and share>=.9 else 0
        parent_share=sum(p['share'] for p in parents)/len(parents) if parents else 0
        v=[math.log1p(total),len(t['inputs']),len(amounts),math.log1p(t['fees'] or 0),share,cv,activity,len(parents),math.log1p(min(gap,86400)),min(depth,20),parent_share,min(fast,20),min(retained,20)]
        # Bounded numerical structural attributes, never IDs or scenario labels.
        own=[math.log1p(len(t['inputs'])),math.log1p(len(amounts)),share,math.log1p(activity),v[8],math.log1p(min(depth,20))]
        def avg(values): return [sum(a[j] for a in values)/len(values) for j in range(6)] if values else [0.]*6
        pmean=avg([p['own'] for p in parents]); gmean=avg([p['pmean'] for p in parents])
        raw.append(v);graph.append(own+pmean+gmean);ids.append(t['txid'])
        seen[t['txid']]={'time':now,'depth':depth,'fast':fast,'retained':retained,'share':share,'own':own,'pmean':pmean}
        for a in addresses: history.setdefault(a,[]).append(now)
    return np.asarray(raw), np.asarray(graph), ids

def project(graph, embedding):
    z=(graph-np.asarray(embedding['mean']))/np.asarray(embedding['scale'])
    return (z-np.asarray(embedding['pca_mean'])) @ np.asarray(embedding['components']).T

def features(rows, embedding=None):
    raw, graph, ids=raw_features(rows)
    return (np.concatenate([raw,project(graph,embedding)],axis=1) if embedding else raw), ids
