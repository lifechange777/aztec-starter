import { AccountWallet, CompleteAddress, ContractDeployer, createLogger, Fr, PXE, waitForPXE, TxStatus, createPXEClient, getContractInstanceFromDeployParams, Logger, createAztecNodeClient, Fq, AztecAddress, createCompatibleClient, L1FeeJuicePortalManager } from "@aztec/aztec.js";
import { getDeployedTestAccountsWallets, getInitialTestAccounts, getInitialTestAccountsWallets } from "@aztec/accounts/testing"
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { deriveSigningKey } from '@aztec/stdlib/keys';
import semver from 'semver';
import type { ContractInstanceWithAddress, FeePaymentMethod, Wallet } from '@aztec/aztec.js';
import { ProtocolContractAddress } from '@aztec/protocol-contracts';
import { type FunctionCall, FunctionSelector, FunctionType } from '@aztec/stdlib/abi';
import { createEthereumChain, createL1Clients } from '@aztec/ethereum';
import { logger, type LogFn } from '@aztec/foundation/log';
import { SponsoredFPCContract } from '@aztec/noir-contracts.js/SponsoredFPC';
import { TestContract } from "@aztec/noir-contracts.js/Test";
import { TokenContract, TokenContractArtifact } from "@aztec/noir-contracts.js/Token";
import { AMMContract, AMMContractArtifact } from "@aztec/noir-contracts.js/AMM";
import { FeeJuicePaymentMethodWithClaim } from '@aztec/aztec.js/fee';

  
  const SPONSORED_FPC_SALT = new Fr(0);
  
  async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
    return await getContractInstanceFromDeployParams(SponsoredFPCContract.artifact, {
      salt: SPONSORED_FPC_SALT,
    });
  }
  
  export async function getSponsoredFPCAddress() {
    return (await getSponsoredFPCInstance()).address;
  }
  
  export async function setupSponsoredFPC(deployer: Wallet, log: LogFn) {
    const deployed = await SponsoredFPCContract.deploy(deployer)
      .send({ contractAddressSalt: SPONSORED_FPC_SALT, universalDeploy: true })
      .deployed();
  
    log(`SponsoredFPC: ${deployed.address}`);
  }
  
  export async function getDeployedSponsoredFPCAddress(pxe: PXE) {
    const fpc = await getSponsoredFPCAddress();
    const contracts = await pxe.getContracts();
    if (!contracts.find(c => c.equals(fpc))) {
      throw new Error('SponsoredFPC not deployed.');
    }
    return fpc;
  }

/**
 * A payment method that uses the SponsoredFPCContract to pay the fee unconditionally.
 */
export class SponsoredFeePaymentMethod implements FeePaymentMethod {
  constructor(
    /**
     * Contract which will pay the fee.
     */
    private paymentContract: AztecAddress,
  ) {}

  static async new(pxe: PXE) {
    const sponsoredFPC = await getDeployedSponsoredFPCAddress(pxe);
    return new SponsoredFeePaymentMethod(sponsoredFPC);
  }

  getAsset(): Promise<AztecAddress> {
    return Promise.resolve(ProtocolContractAddress.FeeJuice);
  }

  getFeePayer(): Promise<AztecAddress> {
    return Promise.resolve(this.paymentContract);
  }

  async getFunctionCalls(): Promise<FunctionCall[]> {
    return [
      {
        name: 'sponsor_unconditionally',
        to: this.paymentContract,
        selector: await FunctionSelector.fromSignature('sponsor_unconditionally()'),
        type: FunctionType.PRIVATE,
        isStatic: false,
        args: [],
        returnTypes: [],
      },
    ];
  }
}

(async () => {
  const state = {
    accounts: [{
      secretKey: '123',
      address: '123',
      salt: '123',
    }],
    contracts: [{
      address: '123',
      type: 'token',
    }, {
      ammAddress: '123',
      token0Address: '123',
      token1Address: '123',
      tokenLiquidityAddress: '123',
    }]
  }
  //AWS; 

  // TODO: Create new PXE's for each run / account
  const pxe = createPXEClient("http://34.82.76.226:8081");
  const node = createAztecNodeClient("http://34.82.76.226:8081");

  const testAccountWallets = await getInitialTestAccountsWallets();
  const accounts = await Promise.all(state.accounts.map(account => getSchnorrAccount(pxe, Fr.fromString(account.secretKey), deriveSigningKey(Fr.fromString(account.secretKey)), Fr.fromString(account.salt))));

  await Promise.all(accounts.map(account => account.register()));
  const contracts = state.contracts;

  const MAX_ACCOUNTS = 2
  const NEW_ACCOUNTS_PER_RUN = 2;
  const MAX_TOKEN_CONTRACTS = 2;
  const NEW_TOKEN_CONTRACTS_PER_RUN = 2;
  const MAX_AMM_CONTRACTS = 2;
  const NEW_AMM_CONTRACTS_PER_RUN = 2;

  const tokenContracts = contracts.filter(contract => contract.type === 'token');
  const ammContracts = contracts.filter(contract => contract.type === 'amm');

  await Promise.all(tokenContracts.map(async contract => {
    pxe.registerContract({instance: await node.getContract(AztecAddress.fromString(contract.address!!)) as ContractInstanceWithAddress, artifact: TokenContractArtifact})
  }));

  await Promise.all(ammContracts.map(async contractGroup => {
    pxe.registerContract({instance: await node.getContract(AztecAddress.fromString(contractGroup.token0Address!)) as ContractInstanceWithAddress, artifact: TokenContractArtifact})
    pxe.registerContract({instance: await node.getContract(AztecAddress.fromString(contractGroup.token1Address!)) as ContractInstanceWithAddress, artifact: TokenContractArtifact})
    pxe.registerContract({instance: await node.getContract(AztecAddress.fromString(contractGroup.tokenLiquidityAddress!)) as ContractInstanceWithAddress, artifact: TokenContractArtifact})
    pxe.registerContract({instance: await node.getContract(AztecAddress.fromString(contractGroup.ammAddress!)) as ContractInstanceWithAddress, artifact: AMMContractArtifact})
  }));


  const newTokenContracts = [];
  for (let i = 0; i < Math.min(MAX_TOKEN_CONTRACTS - tokenContracts.length, NEW_TOKEN_CONTRACTS_PER_RUN); i++) {
    const contract = await TokenContract.deploy(testAccountWallets[0], testAccountWallets[0].getAddress(), 'TokenName', 'TokenSymbol', 18)
      .send()
      .deployed();

    newTokenContracts.push({
      address: contract.address,
      type: 'token'
    });
  };

  const newAMMContracts = [];
  for (let i = 0; i < Math.min(MAX_AMM_CONTRACTS - ammContracts.length, NEW_AMM_CONTRACTS_PER_RUN); i++) {
    const token0Contract = await TokenContract.deploy(testAccountWallets[0], testAccountWallets[0].getAddress(), 'TokenName', 'TokenSymbol', 18)
      .send()
      .deployed();

    const token1Contract = await TokenContract.deploy(testAccountWallets[0], testAccountWallets[0].getAddress(), 'TokenName', 'TokenSymbol', 18)
    .send()
    .deployed();

    const tokenLiquidityContract = await TokenContract.deploy(testAccountWallets[0], testAccountWallets[0].getAddress(), 'TokenName', 'TokenSymbol', 18)
      .send()
      .deployed();

    const ammContract = await AMMContract.deploy(testAccountWallets[0], token0Contract.address, token1Contract.address, tokenLiquidityContract.address)
      .send()
      .deployed();

      newAMMContracts.push({
      token0Address: token0Contract.address,
      token1Address: token1Contract.address,
      tokenLiquidityAddress: tokenLiquidityContract.address,
      ammAddress: ammContract.address,
      type: 'amm'
    });

    const mnemonic = '';
    const l1RpcUrl = '';
    const chainId = 1337;
    // Prepare L1 client
    const chain = createEthereumChain([l1RpcUrl], chainId);
    const { publicClient, walletClient } = createL1Clients(chain.rpcUrls, mnemonic, chain.chainInfo);

    const {
      protocolContractAddresses: { feeJuice: feeJuiceAddress },
    } = await pxe.getPXEInfo();

    // Setup portal manager
    const portal = await L1FeeJuicePortalManager.new(pxe, publicClient, walletClient, createLogger('Portal'));

    const newAccounts = [];
    for (let i = 0; i < Math.min(MAX_ACCOUNTS - accounts.length, NEW_ACCOUNTS_PER_RUN); i++) {
      const secretKey = Fr.random();
      const salt = Fr.random();

      const schnorrAccount = await getSchnorrAccount(pxe, secretKey, deriveSigningKey(secretKey), salt);

      const newAccountAddress = schnorrAccount.getAddress();

      const { claimAmount, claimSecret, messageHash, messageLeafIndex } = await portal.bridgeTokensPublic(
        newAccountAddress,
        999999999999999999999n,
        true,
      );
  
      const delayedCheck = (delay: number) => {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            void pxe
              .getL1ToL2MembershipWitness(feeJuiceAddress, Fr.fromHexString(messageHash), claimSecret)
              .then(witness => resolve(witness))
              .catch(err => reject(err));
          }, delay);
        });
      };
  
      let witness;
  
      let interval = 1000
      while (!witness) {
        witness = await delayedCheck(interval);
        if (!witness) {
          console.log(`No L1 to L2 message found yet, checking again in ${interval / 1000}s`);
        }
      }
      
      const feePaymentMethod = new FeeJuicePaymentMethodWithClaim(await schnorrAccount.getWallet(), {
        claimAmount: (typeof claimAmount === 'string'
          ? Fr.fromHexString(claimAmount)
          : new Fr(claimAmount)
        ).toBigInt(),
        claimSecret,
        messageLeafIndex: BigInt(messageLeafIndex),
      });

      await schnorrAccount.deploy({ fee: { paymentMethod: feePaymentMethod } }).wait();
  
      newAccounts.push({
        secretKey,
        salt,
        address: newAccountAddress
      });
    };

    for (let i = 0; i < accounts.length; i++) {
      const currentAccount = accounts[i];

      await Promise.all(tokenContracts.map(async contract => {
        pxe.registerContract({instance: await node.getContract(AztecAddress.fromString(contract.address!!)) as ContractInstanceWithAddress, artifact: TokenContractArtifact})
      }));

      if (newAccounts.some(newAccount => newAccount.address.equals(currentAccount.getAddress()))) {
        await Promise.all(tokenContracts.map(async contract => {
          const tokenAsMinter = await TokenContract.at(AztecAddress.fromString(contract.address!), testAccountWallets[0]);
          const from = testAccountWallets[0].getAddress(); // we are setting from to minter here because we need a sender to calculate the tag
          await tokenAsMinter.methods.mint_to_private(from, currentAccount.getAddress(), 999999999999999999999n).send().wait();
          await tokenAsMinter.methods.mint_to_public(currentAccount.getAddress(), 999999999999999999999n).send().wait();
        }));
      } else {
        await Promise.all(newTokenContracts.map(async contract => {
          const tokenAsMinter = await TokenContract.at(contract.address!, testAccountWallets[0]);
          const from = testAccountWallets[0].getAddress(); // we are setting from to minter here because we need a sender to calculate the tag
          await tokenAsMinter.methods.mint_to_private(from, currentAccount.getAddress(), 999999999999999999999n).send().wait();
          await tokenAsMinter.methods.mint_to_public(currentAccount.getAddress(), 999999999999999999999n).send().wait();
        }));
      }

      const otherAccounts = accounts.filter(account => !account.getAddress().equals(currentAccount.getAddress()));

      await Promise.all(tokenContracts.map(async contract => {
        const tokenContract = await TokenContract.at(AztecAddress.fromString(contract.address!), await currentAccount.getWallet());

        const privateBalance = await tokenContract.methods.balance_of_private(currentAccount.getAddress()).simulate();
        const publicBalance = await tokenContract.methods.balance_of_public(currentAccount.getAddress()).simulate();

        const amountToTransferPrivate = privateBalance / 2 / otherAccounts.length;
        const amountToTransferPublic = publicBalance / 2 / otherAccounts.length;

        for (let i = 0; i < otherAccounts.length; i++) {
          await tokenContract.methods.transfer_in_private(currentAccount.getAddress(), otherAccounts[i].getAddress(), amountToTransferPrivate, 0).send().wait();
          await tokenContract.methods.transfer_in_public(currentAccount.getAddress(), otherAccounts[i].getAddress(), amountToTransferPublic, 0).send().wait();
        }
      }));
    }


  };
})()
