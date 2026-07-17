// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {LibAccess} from "../libraries/LibAccess.sol";
import {LibVaultStorage} from "../libraries/LibVaultStorage.sol";

/// @title CustodyFacet — ERC-721 receipt + owner rescue (§4.1)
/// @notice Custody state never moves: every upgrade in this system is a facet
/// swap around the NFTs, never a transfer of them. Rescue is a feature under
/// single-owner custody (P6), not a bug — it is the migration/exit path.
contract CustodyFacet {
    using SafeERC20 for IERC20;

    event ERC721Rescued(address indexed token, uint256 indexed tokenId, address indexed to);
    event ERC20Rescued(address indexed token, uint256 amount, address indexed to);
    event PositionReceived(address indexed token, uint256 indexed tokenId, address from);

    error UnexpectedNFT(address sender);

    /// @notice Accept position NFTs from the configured escrow only — the
    /// diamond must never become a dumping ground for arbitrary ERC-721s.
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        if (msg.sender != LibVaultStorage.protocolConfig().votingEscrow) {
            revert UnexpectedNFT(msg.sender);
        }
        emit PositionReceived(msg.sender, tokenId, from);
        return this.onERC721Received.selector;
    }

    function rescueERC721(address token, uint256 tokenId, address to) external {
        LibAccess.enforceOwner();
        IERC721(token).safeTransferFrom(address(this), to, tokenId);
        emit ERC721Rescued(token, tokenId, to);
    }

    function rescueERC20(address token, uint256 amount, address to) external {
        LibAccess.enforceOwner();
        IERC20(token).safeTransfer(to, amount);
        emit ERC20Rescued(token, amount, to);
    }
}
