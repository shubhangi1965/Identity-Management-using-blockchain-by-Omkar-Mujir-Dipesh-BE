<script setup>
    import {ref, onMounted} from "vue";
    import { useI18n } from 'vue-i18n';

    const { t } = useI18n({ useScope: 'global' });

    const props = defineProps({
        chain: {
            type: String,
            required: true,
            default: ''
        }
    });

    const emit = defineEmits(['back', 'continue', 'imported']);

    onMounted(() => {
        if (!["BTS", "BTS_TEST", "TUSC"].includes(props.chain)) {
            throw "Unsupported chain!";
        }
    })

    let inProgress = ref(false);
    let substep1 = ref(true);
    let substep2 = ref(false);
    let wallet_file = ref(null);
    let bin_file_password = ref(null);
    let accounts = ref([]);

    // function to remove account from accounts given an account id
    function removeAccount(id) {
        accounts.value = accounts.value.filter(x => x.id !== id);
    }

    function handleWalletSelect(e) {
        wallet_file.value = e.target.files[0];
    }

    function _getPickedAccounts() {
        let pickedAccounts = [];
        for (let i in accounts.value) {
            let account = accounts.value[i];
            pickedAccounts.push({
                account: {
                    accountName: account.name,
                    accountID: account.id,
                    chain: props.chain,
                    keys: {
                        active: account.active.key,
                        owner: account.owner.key,
                        memo: account.memo.key
                    }
                }
            });
        }
        
        if (pickedAccounts && pickedAccounts.length) {
            console.log('importing accounts');
            emit('imported', pickedAccounts);
        }
    }

    async function next() {
        if (substep1.value) {
            let blockchainResponse;
            try {
                inProgress.value = true;
                blockchainResponse = await window.electron.blockchainRequest({
                    methods: ["decryptBackup"],
                    location: 'importBinFile',
                    chain: props.chain,
                    filePath: wallet_file.value,
                    pass: bin_file_password.value
                });
            } catch (error) {
                console.log(error);
                inProgress.value = false;
                window.electron.notify(t("common.error_text"));
                return;
            }

            if (blockchainResponse && blockchainResponse.decryptBackup) {
                accounts.value = blockchainResponse.decryptBackup;
                substep1.value = false;
                substep2.value = true;
            }
            inProgress.value = false;
        } else {
            _getPickedAccounts();
        }
    }
</script>

<template>
    <div id="step2">
        <template v-if="substep1 && inProgress">
            <ui-progress indeterminate />
            <br>
            <figcaption>
                {{ t('common.import_bin_progress') }}
            </figcaption>
        </template>
        <template v-else-if="substep1">
            <p class="mb-2 font-weight-bold">
                {{ t('common.import_bin_file') }}
            </p>
            <input
                type="file"
                class="form-control mb-3 small"
                @change="handleWalletSelect"
            >
            <p class="mb-2 font-weight-bold">
                {{ t('common.import_bin_pass') }}
            </p>
            <input
                v-model="bin_file_password"
                type="password"
                class="form-control mb-3 small"
            >
            <br>
            <ui-button
                v-if="wallet_file && bin_file_password"
                outlined
                class="step_btn"
                @click="next"
            >
                {{ t('common.next_btn') }}
            </ui-button>
            <br>
            <ui-button
                outlined
                class="step_btn"
                @click="emit('back')"
            >
                {{ t('common.back_btn') }}
            </ui-button>
        </template>
        <template v-if="substep2">
            <div class="import-accounts mt-3">
                <table class="table small table-striped table-sm">
                    <thead>
                        <tr>
                            <th
                                rowspan="2"
                                class="align-middle"
                            >
                                Account Name
                            </th>
                            <th
                                rowspan="2"
                                class="align-middle"
                            >
                                Active Authority
                            </th>
                            <th
                                rowspan="2"
                                class="align-middle"
                            >
                                Owner Authority
                            </th>
                            <th
                                rowspan="2"
                                class="align-middle"
                            >
                                Memo
                            </th>
                            <th
                                rowspan="2"
                                class="align-middle"
                            >
                                Import?
                            </th>
                        </tr>
                        <tr>
                            <th class="align-middle">
                                Propose
                            </th>
                            <th class="align-middle">
                                Remove?
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="account in accounts"
                            :key="account.id"
                            :class="{ disabledImport : !account.importable}"
                        >
                            <td class="text-center align-middle">
                                {{ account.name }}<br>({{ account.id }})
                            </td>
                            <td class="text-center align-middle">
                                {{ account.active.canPropose ? 'Y' : 'N' }}
                            </td>
                            <td class="text-center align-middle">
                                {{ account.active.canTransact ? 'Y' : 'N' }}
                            </td>
                            <td class="text-center align-middle">
                                {{ account.owner.canPropose ? 'Y' : 'N' }}
                            </td>
                            <td class="text-center align-middle">
                                {{ account.owner.canTransact ? 'Y' : 'N' }}
                            </td>
                            <td class="text-center align-middle">
                                {{ account.memo.canSend ? 'Y' : 'N' }}
                            </td>
                            <td class="text-center align-middle">
                                <ui-icon-button
                                    v-if="account.importable"
                                    icon="clear"
                                    outlined
                                    class="step_btn"
                                    @click="removeAccount(account.id)"
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>

                <ui-grid>
                    <ui-grid-cell columns="12">
                        <ui-button
                            outlined
                            class="step_btn"
                            @click="back"
                        >
                            {{ t('common.back_btn') }}
                        </ui-button>

                        <ui-button
                            v-if="substep1 && (!wallet_file || !bin_file_password)"
                            disabled
                            class="step_btn"
                            type="submit"
                        >
                            {{ t('common.next_btn') }}
                        </ui-button>
                        
                        <ui-button
                            v-if="accounts && accounts.length || (substep1 && wallet_file && bin_file_password)"
                            raised
                            class="step_btn"
                            type="submit"
                            @click="next"
                        >
                            {{ t('common.next_btn') }}
                        </ui-button>

                        <ui-button
                            v-if="substep2 && (!accounts || !accounts.length)"
                            disabled
                            class="step_btn"
                            type="submit"
                        >
                            {{ t('common.next_btn') }}
                        </ui-button>
                    </ui-grid-cell>
                </ui-grid>
            </div>
            <!--<button-->
            <!--v-if="picked.length>10"-->
            <!--class="btn btn-lg btn-primary btn-block mt-3"-->
            <!--@click="simpleStep3"-->
            <!--&gt;-->
            <!--{{ t('common.import_btn') }}-->
            <!--</button>-->
        </template>
    </div>
</template>
